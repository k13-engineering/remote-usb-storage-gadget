// the mock implements Node.js APIs, which take positional parameters
/* eslint-disable k13-engineering/prefer-single-object-parameters */

import type { TSystem } from "../system.ts";
import { createRecordingLogger } from "./recording-logger.ts";

type TNode = {
  type: "directory";
  // created by configfs itself, e.g. lun.0 of a mass storage function
  defaultGroup: boolean;
} | {
  type: "file";
  content: Uint8Array;
} | {
  type: "symlink";
  target: string;
};

type TFileHandle = Awaited<ReturnType<TSystem["fs"]["promises"]["open"]>>;
// typed here instead of derived from linux-fuse, so the mock does not depend on the exact declarations
type TRequestHandler = {
  handleRequest: (args: { request: never }) => Promise<unknown>;
};

type TMountResult = {
  error: undefined;
  mountFd: number;
} | {
  error: Error;
  mountFd: undefined;
};

const CONFIGFS_MAGIC = 0x62_65_65_70;
const TMPFS_MAGIC = 0x01_02_19_94;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const fsError = ({ code, syscall, path }: { code: string; syscall: string; path: string }) => {
  // eslint-disable-next-line fp/no-mutating-assign
  return Object.assign(Error(`${code}: ${syscall} '${path}'`), { code });
};

const parentOf = ({ path }: { path: string }) => {
  const index = path.lastIndexOf("/");
  return index === 0 ? "/" : path.slice(0, index);
};

const nameOf = ({ path }: { path: string }) => {
  return path.slice(path.lastIndexOf("/") + 1);
};

const toBytes = ({ content }: { content: string | Uint8Array }) => {
  return typeof content === "string" ? textEncoder.encode(content) : Uint8Array.from(content);
};

// an in-memory filesystem with the semantics of configfs where this package relies on them
// eslint-disable-next-line max-statements
const createMockFilesystem = ({ configfsRoot, configfsMounted }: { configfsRoot: string; configfsMounted: boolean }) => {
  let nodes = new Map<string, TNode>([["/", { type: "directory", defaultGroup: false }]]);
  let writes: { path: string; content: string }[] = [];
  let closedFds: number[] = [];
  let openedPaths: string[] = [];

  const lookup = ({ path, syscall }: { path: string; syscall: string }) => {
    const node = nodes.get(path);
    if (node === undefined) {
      throw fsError({ code: "ENOENT", syscall, path });
    }

    return node;
  };

  const childrenOf = ({ path }: { path: string }) => {
    const prefix = path === "/" ? "/" : `${path}/`;
    return [...nodes.keys()].filter((candidate) => {
      return candidate.startsWith(prefix) && candidate !== path && !candidate.slice(prefix.length).includes("/");
    });
  };

  const setNode = ({ path, node, syscall }: { path: string; node: TNode; syscall: string }) => {
    const parent = nodes.get(parentOf({ path }));
    if (parent?.type !== "directory") {
      throw fsError({ code: "ENOENT", syscall, path });
    }

    nodes = new Map([...nodes, [path, node]]);
  };

  const removeNodes = ({ paths }: { paths: string[] }) => {
    nodes = new Map([...nodes].filter(([path]) => {
      return !paths.includes(path);
    }));
  };

  const gadgetRoot = `${configfsRoot}/usb_gadget`;

  const defaultGroupRules = [
    { pattern: /^\/[^/]+$/, defaultGroups: ["configs", "functions", "strings"] },
    { pattern: /^\/[^/]+\/configs\/[^/]+$/, defaultGroups: ["strings"] },
    { pattern: /^\/[^/]+\/functions\/mass_storage\.[^/]+$/, defaultGroups: ["lun.0"] },
  ];

  const defaultGroupsOf = ({ path }: { path: string }) => {
    if (!path.startsWith(`${gadgetRoot}/`)) {
      return [];
    }

    const pathInGadgetRoot = path.slice(gadgetRoot.length);
    return defaultGroupRules.filter(({ pattern }) => {
      return pattern.test(pathInGadgetRoot);
    }).flatMap(({ defaultGroups }) => {
      return defaultGroups;
    });
  };

  const makeDirectory = ({ path, defaultGroup }: { path: string; defaultGroup: boolean }) => {
    setNode({ path, node: { type: "directory", defaultGroup }, syscall: "mkdir" });

    // configfs creates some directories and attributes itself, e.g. the logical unit of a mass storage
    // function, the strings of a configuration and the UDC attribute of a gadget, which is empty while unbound
    defaultGroupsOf({ path }).forEach((name) => {
      makeDirectory({ path: `${path}/${name}`, defaultGroup: true });
    });

    if (parentOf({ path }) === gadgetRoot) {
      setNode({ path: `${path}/UDC`, node: { type: "file", content: textEncoder.encode("\n") }, syscall: "mkdir" });
    }
  };

  const makeDirectoryRecursive = ({ path }: { path: string }) => {
    if (nodes.has(path)) {
      return;
    }

    makeDirectoryRecursive({ path: parentOf({ path }) });
    makeDirectory({ path, defaultGroup: false });
  };

  const mkdirSync = (path: string, options?: { recursive?: boolean }) => {
    if (options?.recursive) {
      makeDirectoryRecursive({ path });
      return;
    }

    if (nodes.has(path)) {
      throw fsError({ code: "EEXIST", syscall: "mkdir", path });
    }

    makeDirectory({ path, defaultGroup: false });
  };

  const writeFile = ({ path, content }: { path: string; content: string | Uint8Array }) => {
    if (nodes.get(path)?.type === "directory") {
      throw fsError({ code: "EISDIR", syscall: "open", path });
    }

    setNode({ path, node: { type: "file", content: toBytes({ content }) }, syscall: "open" });
    writes = [...writes, { path, content: typeof content === "string" ? content : textDecoder.decode(content) }];
  };

  const readFile = ({ path }: { path: string }) => {
    const node = lookup({ path, syscall: "open" });
    if (node.type !== "file") {
      throw fsError({ code: "EISDIR", syscall: "read", path });
    }

    return node.content;
  };

  // configfs removes attribute files and default groups together with their directory
  const removableTogetherWith = ({ path }: { path: string }): string[] => {
    return childrenOf({ path }).flatMap((child) => {
      const node = nodes.get(child) as TNode;
      if (node.type === "file") {
        return [child];
      }

      if (node.type === "directory" && node.defaultGroup) {
        return [child, ...removableTogetherWith({ path: child })];
      }

      throw fsError({ code: "ENOTEMPTY", syscall: "rmdir", path });
    });
  };

  const rmdirSync = (path: string) => {
    const node = lookup({ path, syscall: "rmdir" });
    if (node.type !== "directory") {
      throw fsError({ code: "ENOTDIR", syscall: "rmdir", path });
    }

    removeNodes({ paths: [path, ...removableTogetherWith({ path })] });
  };

  const readdirSync = (path: string, options?: { withFileTypes?: boolean }) => {
    lookup({ path, syscall: "scandir" });
    const children = childrenOf({ path });

    if (!options?.withFileTypes) {
      return children.map((child) => {
        return nameOf({ path: child });
      });
    }

    return children.map((child) => {
      const node = nodes.get(child) as TNode;
      return {
        name: nameOf({ path: child }),
        isDirectory: () => {
          return node.type === "directory";
        },
        isFile: () => {
          return node.type === "file";
        },
        isSymbolicLink: () => {
          return node.type === "symlink";
        },
      };
    });
  };

  const createFileHandle = ({ path, fd }: { path: string; fd: number }) => {
    const content = () => {
      return readFile({ path });
    };

    return {
      fd,

      stat: async (options?: { bigint?: boolean }) => {
        const size = content().length;
        return { size: options?.bigint ? BigInt(size) : size };
      },

      read: async (buffer: Uint8Array, offset: number, length: number, position: number) => {
        const data = content().subarray(position, position + length);
        buffer.set(data, offset);
        return { bytesRead: data.length, buffer };
      },

      write: async (data: Uint8Array, offset: number, length: number, position: number) => {
        const previous = content();
        const updated = new Uint8Array(Math.max(previous.length, position + length));
        updated.set(previous);
        updated.set(data.subarray(offset, offset + length), position);
        nodes = new Map([...nodes, [path, { type: "file", content: updated }]]);
        return { bytesWritten: length, buffer: data };
      },

      close: async () => {
        closedFds = [...closedFds, fd];
      },
    };
  };

  let nextFd = 20;
  let statCalls = 0;

  const createProcFileHandle = ({ fd }: { fd: number }) => {
    return {
      fd,

      stat: async () => {
        statCalls += 1;
        return { size: 0 };
      },

      close: async () => {
        closedFds = [...closedFds, fd];
      },
    };
  };

  const fs = {
    mkdirSync,

    writeFileSync: (path: string, content: string | Uint8Array) => {
      writeFile({ path, content });
    },

    readFileSync: (path: string) => {
      return textDecoder.decode(readFile({ path }));
    },

    symlinkSync: (target: string, path: string) => {
      setNode({ path, node: { type: "symlink", target }, syscall: "symlink" });
    },

    readdirSync,
    rmdirSync,

    unlinkSync: (path: string) => {
      const node = lookup({ path, syscall: "unlink" });
      if (node.type === "directory") {
        throw fsError({ code: "EISDIR", syscall: "unlink", path });
      }

      removeNodes({ paths: [path] });
    },

    statSync: (path: string) => {
      const node = lookup({ path, syscall: "stat" });
      return {
        isDirectory: () => {
          return node.type === "directory";
        },
      };
    },

    statfsSync: (path: string) => {
      lookup({ path, syscall: "statfs" });
      return { type: configfsMounted && path.startsWith(configfsRoot) ? CONFIGFS_MAGIC : TMPFS_MAGIC };
    },

    closeSync: (fd: number) => {
      closedFds = [...closedFds, fd];
    },

    promises: {
      writeFile: async (path: string, content: string | Uint8Array) => {
        writeFile({ path, content });
      },

      open: async (path: string) => {
        openedPaths = [...openedPaths, path];
        nextFd += 1;

        // like the magic links in procfs, which are not part of this filesystem, such paths can always be opened
        if (path.startsWith("/proc/")) {
          return createProcFileHandle({ fd: nextFd });
        }

        lookup({ path, syscall: "open" });
        return createFileHandle({ path, fd: nextFd });
      },

      rm: async (path: string, options?: { force?: boolean }) => {
        if (!nodes.has(path) && options?.force) {
          return;
        }

        lookup({ path, syscall: "rm" });
        removeNodes({ paths: [path] });
      },

      symlink: async (target: string, path: string) => {
        setNode({ path, node: { type: "symlink", target }, syscall: "symlink" });
      },
    },
  };

  return {
    fs,

    // inspection for tests

    exists: ({ path }: { path: string }) => {
      return nodes.has(path);
    },

    readText: ({ path }: { path: string }) => {
      return textDecoder.decode(readFile({ path }));
    },

    readBytes: ({ path }: { path: string }) => {
      return readFile({ path });
    },

    symlinkTarget: ({ path }: { path: string }) => {
      const node = lookup({ path, syscall: "readlink" });
      return node.type === "symlink" ? node.target : undefined;
    },

    paths: ({ under }: { under: string }) => {
      return [...nodes.keys()].filter((path) => {
        return path.startsWith(`${under}/`);
      }).toSorted((a, b) => {
        return a < b ? -1 : 1;
      });
    },

    writes: () => {
      return writes;
    },

    closedFds: () => {
      return closedFds;
    },

    openedPaths: () => {
      return openedPaths;
    },

    statCalls: () => {
      return statCalls;
    },
  };
};

// the fuse functions of linux-fuse, captures the server interface instead of talking to the kernel
const createMockFuse = () => {
  let requestHandler: TRequestHandler | undefined = undefined;
  let mountResult: TMountResult = { error: undefined, mountFd: 10 };
  let openFuseFdError: Error | undefined = undefined;
  let mountOptions: unknown[] = [];
  let closed = false;

  const fuse = {
    openFuseFd: () => {
      if (openFuseFdError !== undefined) {
        return { error: openFuseFdError, fuseFd: undefined };
      }

      return { error: undefined, fuseFd: 9 };
    },

    createFuseFileSystem: (options: { fuseFd: number; requestHandler: TRequestHandler }) => {
      requestHandler = options.requestHandler;

      return {
        mountDetached: (args: unknown) => {
          mountOptions = [...mountOptions, args];
          return mountResult;
        },
        close: () => {
          closed = true;
        },
      };
    },
  };

  return {
    fuse,

    failOpen: ({ error }: { error: Error }) => {
      openFuseFdError = error;
    },

    failMount: ({ error }: { error: Error }) => {
      mountResult = { error, mountFd: undefined };
    },

    mountOptions: () => {
      return mountOptions;
    },

    isClosed: () => {
      return closed;
    },

    // sends a request to the filesystem as the kernel would
    request: async ({ opcode, request }: { opcode: string; request: object }) => {
      if (requestHandler === undefined) {
        throw Error("no filesystem created");
      }

      return requestHandler.handleRequest({
        request: { opcode, unique: 1n, requester: { uid: 0n, gid: 0n, pid: 1n }, ...request } as never,
      });
    },
  };
};

const createMockSystem = ({ configfsMounted = true }: { configfsMounted?: boolean } = {}) => {
  const configfsRoot = "/sys/kernel/config";
  const filesystem = createMockFilesystem({ configfsRoot, configfsMounted });
  const mockFuse = createMockFuse();
  const recordingLogger = createRecordingLogger();

  filesystem.fs.mkdirSync(`${configfsRoot}/usb_gadget`, { recursive: true });
  filesystem.fs.mkdirSync("/tmp", { recursive: true });

  const system = {
    fs: filesystem.fs,
    fuse: mockFuse.fuse,
    logger: recordingLogger.logger,
    pid: 4242,
  };

  return {
    // cast, as the mock only implements the parts of the APIs this package uses
    system: system as unknown as TSystem,

    filesystem,
    mockFuse,
    recordingLogger,
  };
};

export {
  createMockSystem,
};

export type {
  TFileHandle,
};
