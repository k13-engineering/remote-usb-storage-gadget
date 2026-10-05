import nodeOs from "node:os";
import {
  createConvenienceRequestHandler,
  createDefaultInitResult,
  defaultFusePath,
  direntsToBuffer,
  type TDirent,
  type TFuseServerInterface,
} from "@k13engineering/linux-fuse";
import type { TBlockDevice } from "./client.ts";
import { realSystem, type TLogger, type TSystem } from "./system.ts";

const { EIO, ENOENT, ENOSYS, ENOTDIR } = nodeOs.constants.errno;

const rootNodeId = 1n;
const virtualFileNodeId = 2n;
const virtualFileName = "virtual";

const S_IFDIR = 0o040000n;
const S_IFREG = 0o100000n;

// see FUSE_ASYNC_READ in <linux/fuse.h>, lets the kernel issue several reads at once
const FUSE_ASYNC_READ = 1n << 0n;

// see FUSE_BIG_WRITES in <linux/fuse.h>, without it the kernel sends a separate write for every page
const FUSE_BIG_WRITES = 1n << 5n;

type TFuseAttr = Extract<Awaited<ReturnType<TFuseServerInterface["getattr"]>>, { errorCode: undefined }>["result"]["attr"];

const nowNsec = () => {
  return BigInt(Date.now()) * 1_000_000n;
};

const createAttr = ({ ino, mode, nlink, size }: { ino: bigint; mode: bigint; nlink: bigint; size: bigint }): TFuseAttr => {
  const now = nowNsec();

  return {
    ino,
    mode,
    nlink,
    uid: 0n,
    gid: 0n,
    rdev: 0n,
    size,
    blksize: 4096n,
    blocks: (size + 511n) / 512n,
    atimeNsec: now,
    mtimeNsec: now,
    ctimeNsec: now,
  };
};

const notImplemented = <T extends string>({ forOpcode }: { forOpcode: T }) => {
  return async () => {
    return { forOpcode, errorCode: -ENOSYS, result: undefined };
  };
};

// a filesystem with a single file in its root directory, which reads from and writes to the assigned block device
const createVirtualFileServerInterface = ({
  blockDevice,
  logger,
}: {
  blockDevice: () => TBlockDevice | undefined;
  logger: TLogger;
}): TFuseServerInterface => {

  let nextFileHandle = 1n;

  const virtualFileSize = async () => {
    const currentBlockDevice = blockDevice();
    if (currentBlockDevice === undefined) {
      return 0n;
    }

    try {
      const { geometry } = await currentBlockDevice.queryGeometry();
      return geometry.numberOfPhysicalBlocks * BigInt(geometry.physicalBlockSize);
    } catch (ex) {
      logger.error(ex);
      return 0n;
    }
  };

  const virtualFileAttr = async () => {
    return createAttr({ ino: virtualFileNodeId, mode: S_IFREG | 0o644n, nlink: 1n, size: await virtualFileSize() });
  };

  const attrOfNode = async ({ nodeId }: { nodeId: bigint }): Promise<TFuseAttr | undefined> => {
    if (nodeId === rootNodeId) {
      return createAttr({ ino: rootNodeId, mode: S_IFDIR | 0o755n, nlink: 2n, size: 0n });
    }

    if (nodeId === virtualFileNodeId) {
      return virtualFileAttr();
    }

    return undefined;
  };

  const getattr = async ({ nodeId }: { nodeId: bigint }) => {
    const attr = await attrOfNode({ nodeId });
    if (attr === undefined) {
      return { forOpcode: "GETATTR", errorCode: -ENOENT, result: undefined } as const;
    }

    // attributes are never cached, so the size follows the assigned block device
    return { forOpcode: "GETATTR", errorCode: undefined, result: { attrValidNsec: 0n, attr } } as const;
  };

  const blockDeviceOrError = ({ operation }: { operation: string }) => {
    const currentBlockDevice = blockDevice();
    if (currentBlockDevice === undefined) {
      logger.error(`${operation} without block device`);
    }

    return currentBlockDevice;
  };

  const directoryEntries: TDirent[] = [
    { inode: rootNodeId, nextOffset: 1n, fileType: "DT_DIR", name: "." },
    { inode: rootNodeId, nextOffset: 2n, fileType: "DT_DIR", name: ".." },
    { inode: virtualFileNodeId, nextOffset: 3n, fileType: "DT_REG", name: virtualFileName },
  ];

  return {
    init: async () => {
      return {
        forOpcode: "INIT",
        errorCode: undefined,
        result: {
          ...createDefaultInitResult(),
          maxReadahead: 128n * 1024n,
          flags: FUSE_ASYNC_READ | FUSE_BIG_WRITES,
        },
      };
    },

    // the nodes of this filesystem are static, so there is nothing to forget
    forget: async () => {},
    batchForget: async () => {},
    interrupt: async () => {},
    notifyReply: async () => {},

    destroy: async () => {
      return { forOpcode: "DESTROY", errorCode: undefined, result: {} };
    },

    lookup: async ({ parentNodeId, name }) => {
      if (parentNodeId !== rootNodeId || name !== virtualFileName) {
        return { forOpcode: "LOOKUP", errorCode: -ENOENT, result: undefined };
      }

      const attr = await virtualFileAttr();

      return {
        forOpcode: "LOOKUP",
        errorCode: undefined,
        result: { nodeId: virtualFileNodeId, generation: 0n, entryValidNsec: 0n, attrValidNsec: 0n, attr },
      };
    },

    getattr,

    fgetattr: async () => {
      // only the virtual file is opened with file handles
      return getattr({ nodeId: virtualFileNodeId });
    },

    open: async ({ nodeId }) => {
      if (nodeId !== virtualFileNodeId) {
        return { forOpcode: "OPEN", errorCode: -ENOENT, result: undefined };
      }

      const fh = nextFileHandle;
      nextFileHandle += 1n;

      return {
        forOpcode: "OPEN",
        errorCode: undefined,
        result: { fh, openFlagsToKernel: { directIo: false, keepCache: false, nonSeekable: false } },
      };
    },

    read: async ({ offset, size }) => {
      const currentBlockDevice = blockDeviceOrError({ operation: "read" });
      if (currentBlockDevice === undefined) {
        return { forOpcode: "READ", errorCode: -EIO, result: undefined };
      }

      try {
        const data = await currentBlockDevice.read({ offset, length: Number(size) });
        return { forOpcode: "READ", errorCode: undefined, result: { data } };
      } catch (ex) {
        logger.error(ex);
        return { forOpcode: "READ", errorCode: -EIO, result: undefined };
      }
    },

    write: async ({ offset, data }) => {
      const currentBlockDevice = blockDeviceOrError({ operation: "write" });
      if (currentBlockDevice === undefined) {
        return { forOpcode: "WRITE", errorCode: -EIO, result: undefined };
      }

      try {
        await currentBlockDevice.write({ offset, data });
        return { forOpcode: "WRITE", errorCode: undefined, result: { bytesWritten: BigInt(data.length) } };
      } catch (ex) {
        logger.error(ex);
        return { forOpcode: "WRITE", errorCode: -EIO, result: undefined };
      }
    },

    fsync: async () => {
      return { forOpcode: "FSYNC", errorCode: undefined, result: {} };
    },

    release: async () => {
      return { forOpcode: "RELEASE", errorCode: undefined, result: {} };
    },

    opendir: async ({ nodeId }) => {
      if (nodeId !== rootNodeId) {
        return { forOpcode: "OPENDIR", errorCode: -ENOTDIR, result: undefined };
      }

      return {
        forOpcode: "OPENDIR",
        errorCode: undefined,
        result: { fh: 0n, openFlagsToKernel: { directIo: false, keepCache: false, nonSeekable: false } },
      };
    },

    readdir: async ({ offset, size }) => {
      const data = direntsToBuffer({ entries: directoryEntries.slice(Number(offset)), maxLength: Number(size) });
      return { forOpcode: "READDIR", errorCode: undefined, result: { data } };
    },

    releasedir: async () => {
      return { forOpcode: "RELEASEDIR", errorCode: undefined, result: {} };
    },

    statfs: async () => {
      // same values libfuse reports for filesystems without statfs
      return {
        forOpcode: "STATFS",
        errorCode: undefined,
        result: { blocks: 0n, bfree: 0n, bavail: 0n, files: 0n, ffree: 0n, bsize: 512n, namelen: 255n, frsize: 0n },
      };
    },

    // writes are passed to the block device right away, so there is nothing to flush. Replying ENOSYS
    // makes the kernel stop sending FLUSH, see createFuseVirtualFile why that matters
    flush: notImplemented({ forOpcode: "FLUSH" }),

    setattr: notImplemented({ forOpcode: "SETATTR" }),
    listxattr: notImplemented({ forOpcode: "LISTXATTR" }),
    getxattr: notImplemented({ forOpcode: "GETXATTR" }),
    readlink: notImplemented({ forOpcode: "READLINK" }),
    symlink: notImplemented({ forOpcode: "SYMLINK" }),
    mknod: notImplemented({ forOpcode: "MKNOD" }),
    mkdir: notImplemented({ forOpcode: "MKDIR" }),
    unlink: notImplemented({ forOpcode: "UNLINK" }),
    rmdir: notImplemented({ forOpcode: "RMDIR" }),
    rename: notImplemented({ forOpcode: "RENAME" }),
    link: notImplemented({ forOpcode: "LINK" }),
    fsyncdir: notImplemented({ forOpcode: "FSYNCDIR" }),
    access: notImplemented({ forOpcode: "ACCESS" }),
    setxattr: notImplemented({ forOpcode: "SETXATTR" }),
    removexattr: notImplemented({ forOpcode: "REMOVEXATTR" }),
    create: notImplemented({ forOpcode: "CREATE" }),
    getlk: notImplemented({ forOpcode: "GETLK" }),
    setlk: notImplemented({ forOpcode: "SETLK" }),
    setlkw: notImplemented({ forOpcode: "SETLKW" }),
    bmap: notImplemented({ forOpcode: "BMAP" }),
    ioctl: notImplemented({ forOpcode: "IOCTL" }),
    poll: notImplemented({ forOpcode: "POLL" }),
    fallocate: notImplemented({ forOpcode: "FALLOCATE" }),
    readdirplus: notImplemented({ forOpcode: "READDIRPLUS" }),
    lseek: notImplemented({ forOpcode: "LSEEK" }),
    copyFileRange: notImplemented({ forOpcode: "COPY_FILE_RANGE" }),
    setupMapping: notImplemented({ forOpcode: "SETUPMAPPING" }),
    removeMapping: notImplemented({ forOpcode: "REMOVEMAPPING" }),
    syncfs: notImplemented({ forOpcode: "SYNCFS" }),
    tmpfile: notImplemented({ forOpcode: "TMPFILE" }),
    statx: notImplemented({ forOpcode: "STATX" }),
  };
};

const mountVirtualFileSystem = ({ system, serverInterface }: { system: TSystem; serverInterface: TFuseServerInterface }) => {
  const { error: openError, fuseFd } = system.fuse.openFuseFd({ fusePath: defaultFusePath });
  if (openError !== undefined) {
    throw openError;
  }

  const fileSystem = system.fuse.createFuseFileSystem({
    fuseFd,
    requestHandler: createConvenienceRequestHandler({ serverInterface }),
  });

  // a detached mount is not attached anywhere in the filesystem tree and lives as long as files on it are open
  const { error: mountError, mountFd } = fileSystem.mountDetached({
    // the gadget needs root to configure configfs, so the mount belongs to root
    requiredOptions: { rootmode: Number(S_IFDIR), user_id: 0, group_id: 0 },
    otherOptions: {},
    mountAttributes: { MOUNT_ATTR_NOSUID: true, MOUNT_ATTR_NODEV: true, MOUNT_ATTR_NOEXEC: true },
  });

  if (mountError !== undefined) {
    fileSystem.close();
    throw mountError;
  }

  return { fileSystem, mountFd };
};

type TFileHandle = Awaited<ReturnType<TSystem["fs"]["promises"]["open"]>>;

const openVirtualFileOnMount = async ({ system, mountFd }: { system: TSystem; mountFd: number }) => {
  try {
    // must not block the event loop, which serves the requests of the open
    return await system.fs.promises.open(`/proc/${system.pid}/fd/${mountFd}/${virtualFileName}`, "r+");
  } finally {
    // the open file keeps the mount alive
    system.fs.closeSync(mountFd);
  }
};

const prepareVirtualFile = async ({ system, fd }: { system: TSystem; fd: number }) => {
  // closing a file on fuse waits for the reply to FLUSH without a timeout. If this process exited with the
  // virtual file open, nobody could reply anymore and the exit would hang forever. Closing a second handle
  // now lets the kernel learn that FLUSH is not implemented, so it never sends it again
  const flushProbe = await system.fs.promises.open(`/proc/${system.pid}/fd/${fd}`, "r");
  await flushProbe.close();

  system.logger.log("fd is", fd);

  const fuseBlockDebugLink = "/tmp/fuse-block-debug";
  await system.fs.promises.rm(fuseBlockDebugLink, { force: true });
  await system.fs.promises.symlink(`/proc/${system.pid}/fd/${fd}`, fuseBlockDebugLink);

  system.logger.log(`fuse block device for debugging is available at ${fuseBlockDebugLink}`);
};

// aborts the fuse connection if the virtual file cannot be opened and prepared, so nothing is left behind
const openVirtualFile = async ({ system, mountFd, abort }: { system: TSystem; mountFd: number; abort: () => void }) => {
  let virtualFile: TFileHandle | undefined = undefined;

  try {
    virtualFile = await openVirtualFileOnMount({ system, mountFd });
    await prepareVirtualFile({ system, fd: virtualFile.fd });
    return virtualFile;
  } catch (ex) {
    abort();
    await virtualFile?.close();
    throw ex;
  }
};

const createFuseVirtualFile = async ({ system = realSystem }: { system?: TSystem } = {}) => {

  let blockDevice: TBlockDevice | undefined = undefined;

  const serverInterface = createVirtualFileServerInterface({
    blockDevice: () => {
      return blockDevice;
    },
    logger: system.logger,
  });

  const { fileSystem, mountFd } = mountVirtualFileSystem({ system, serverInterface });

  let aborted = false;

  // closing the fuse device aborts the connection. The kernel then fails all requests to the virtual file
  // itself, also those that already wait for a reply, so unlike replying this does not need the event loop.
  // The virtual file cannot be used anymore afterwards
  const abort = () => {
    if (aborted) {
      return;
    }

    aborted = true;
    fileSystem.close();
  };

  const virtualFile = await openVirtualFile({ system, mountFd, abort });
  const { fd } = virtualFile;

  const assign = async ({ blockDevice: newBlockDevice }: { blockDevice: TBlockDevice | undefined }) => {
    blockDevice = newBlockDevice;

    // makes the kernel query the attributes again, so it sees the size of the new block device
    await virtualFile.stat();
  };

  // aborts the connection if that did not happen yet and closes the virtual file of this process
  const close = async () => {
    abort();
    await virtualFile.close();
  };

  return {
    assign,
    abort,
    close,

    fd
  };
};

type TFuseVirtualFile = Awaited<ReturnType<typeof createFuseVirtualFile>>;

export {
  createFuseVirtualFile,
  createVirtualFileServerInterface,
};

export type {
  TFuseVirtualFile,
};
