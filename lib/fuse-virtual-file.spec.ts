import assert from "node:assert/strict";
import { describe, it } from "mocha";
import {
  createDefaultInitResult,
  direntsToBuffer,
  type TFuseServerInterface
} from "@k13engineering/linux-fuse";

import type { TBlockDevice } from "./client.ts";
import { createFuseVirtualFile, createVirtualFileServerInterface } from "./fuse-virtual-file.ts";
import { createMockSystem } from "./test-utils/mock-system.ts";
import { createRecordingLogger } from "./test-utils/recording-logger.ts";

const EIO = -5;
const ENOENT = -2;
const ENOSYS = -38;
const ENOTDIR = -20;

const requestBase = { unique: 1n, requester: { uid: 0n, gid: 0n, pid: 1n } };

const createFakeBlockDevice = ({ failing = false }: { failing?: boolean } = {}) => {
  let writes: { offset: bigint; data: Uint8Array }[] = [];

  const failIfRequested = () => {
    if (failing) {
      throw Error("remote failure");
    }
  };

  const blockDevice: TBlockDevice = {
    read: async ({ offset, length }) => {
      failIfRequested();
      return Uint8Array.from(Array(length).keys(), (value) => {
        return (Number(offset) + value) % 256;
      });
    },

    write: async ({ offset, data }) => {
      failIfRequested();
      writes = [...writes, { offset, data }];
    },

    queryGeometry: async () => {
      failIfRequested();
      return { geometry: { physicalBlockSize: 512, numberOfPhysicalBlocks: 2048n } };
    },
  };

  return {
    blockDevice,
    writes: () => {
      return writes;
    },
  };
};

const createTestServerInterface = ({ blockDevice }: { blockDevice?: TBlockDevice } = {}) => {
  const recordingLogger = createRecordingLogger();
  const serverInterface = createVirtualFileServerInterface({
    blockDevice: () => {
      return blockDevice;
    },
    logger: recordingLogger.logger,
  });

  return {
    serverInterface,
    recordingLogger,
  };
};

const notImplementedMethods: (keyof TFuseServerInterface)[] = [
  "flush",
  "setattr",
  "listxattr",
  "getxattr",
  "readlink",
  "symlink",
  "mknod",
  "mkdir",
  "unlink",
  "rmdir",
  "rename",
  "link",
  "fsyncdir",
  "access",
  "setxattr",
  "removexattr",
  "create",
  "getlk",
  "setlk",
  "setlkw",
  "bmap",
  "ioctl",
  "poll",
  "fallocate",
  "readdirplus",
  "lseek",
  "copyFileRange",
  "setupMapping",
  "removeMapping",
  "syncfs",
  "tmpfile",
  "statx",
];

describe("fuse-virtual-file", () => {
  describe("filesystem", () => {
    describe("lifecycle", () => {
      it("should negotiate asynchronous reads, big writes and a large readahead", async () => {
        const { serverInterface } = createTestServerInterface();

        const response = await serverInterface.init({ ...requestBase, opcode: "INIT", major: 7n, minor: 45n });

        // FUSE_ASYNC_READ | FUSE_BIG_WRITES
        assert.deepStrictEqual(response, {
          forOpcode: "INIT",
          errorCode: undefined,
          result: { ...createDefaultInitResult(), flags: 33n, maxReadahead: 131_072n },
        });
      });

      it("should accept requests that need no reply", async () => {
        const { serverInterface } = createTestServerInterface();

        await serverInterface.forget({ ...requestBase, opcode: "FORGET", nodeId: 2n, lookupCount: 1n });
        await serverInterface.batchForget({ ...requestBase, opcode: "BATCH_FORGET", forgets: [] });
        await serverInterface.interrupt({ ...requestBase, opcode: "INTERRUPT", targetUnique: 3n });
        await serverInterface.notifyReply({ ...requestBase, opcode: "NOTIFY_REPLY", data: new Uint8Array(0) });
      });

    });

    describe("lookup and attributes", () => {
      it("should look up the virtual file in the root directory", async () => {
        const { blockDevice } = createFakeBlockDevice();
        const { serverInterface } = createTestServerInterface({ blockDevice });

        const response = await serverInterface.lookup({ ...requestBase, opcode: "LOOKUP", parentNodeId: 1n, name: "virtual" });

        const { nodeId, entryValidNsec, attr } = response.result ?? assert.fail("lookup failed");
        assert.strictEqual(nodeId, 2n);
        assert.strictEqual(entryValidNsec, 0n);
        assert.strictEqual(attr.mode, 0o100_644n);
        assert.strictEqual(attr.size, 2048n * 512n);
      });

      [
        { parentNodeId: 1n, name: "other" },
        { parentNodeId: 2n, name: "virtual" },
      ].forEach(({ parentNodeId, name }) => {
        it(`should not find ${name} in node ${parentNodeId}`, async () => {
          const { serverInterface } = createTestServerInterface();

          const response = await serverInterface.lookup({ ...requestBase, opcode: "LOOKUP", parentNodeId, name });

          assert.deepStrictEqual(response, { forOpcode: "LOOKUP", errorCode: ENOENT, result: undefined });
        });
      });

      it("should report the root directory", async () => {
        const { serverInterface } = createTestServerInterface();

        const response = await serverInterface.getattr({ ...requestBase, opcode: "GETATTR", getattrMode: "node", nodeId: 1n });

        assert.strictEqual(response.result?.attrValidNsec, 0n);
        assert.strictEqual(response.result?.attr.mode, 0o40_755n);
        assert.strictEqual(response.result?.attr.nlink, 2n);
      });

      it("should report the size of the assigned block device", async () => {
        const { blockDevice } = createFakeBlockDevice();
        const { serverInterface } = createTestServerInterface({ blockDevice });

        const response = await serverInterface.fgetattr({ ...requestBase, opcode: "GETATTR", getattrMode: "fileHandle", fh: 1n });

        assert.strictEqual(response.result?.attr.size, 1_048_576n);
        assert.strictEqual(response.result?.attr.blocks, 2048n);
      });

      it("should report an empty virtual file without block device", async () => {
        const { serverInterface } = createTestServerInterface();

        const response = await serverInterface.getattr({ ...requestBase, opcode: "GETATTR", getattrMode: "node", nodeId: 2n });

        assert.strictEqual(response.result?.attr.size, 0n);
      });

      it("should report an empty virtual file if the geometry cannot be queried", async () => {
        const { blockDevice } = createFakeBlockDevice({ failing: true });
        const { serverInterface, recordingLogger } = createTestServerInterface({ blockDevice });

        const response = await serverInterface.getattr({ ...requestBase, opcode: "GETATTR", getattrMode: "node", nodeId: 2n });

        assert.strictEqual(response.result?.attr.size, 0n);
        assert.deepStrictEqual(recordingLogger.lines(), ["error: Error: remote failure"]);
      });

      it("should not know other nodes", async () => {
        const { serverInterface } = createTestServerInterface();

        const response = await serverInterface.getattr({ ...requestBase, opcode: "GETATTR", getattrMode: "node", nodeId: 3n });

        assert.deepStrictEqual(response, { forOpcode: "GETATTR", errorCode: ENOENT, result: undefined });
      });

    });

    describe("virtual file", () => {
      it("should open the virtual file with a new file handle each time", async () => {
        const { serverInterface } = createTestServerInterface();

        const first = await serverInterface.open({ ...requestBase, opcode: "OPEN", nodeId: 2n, flags: 2n });
        const second = await serverInterface.open({ ...requestBase, opcode: "OPEN", nodeId: 2n, flags: 2n });

        assert.strictEqual(first.result?.fh, 1n);
        assert.strictEqual(second.result?.fh, 2n);
        assert.deepStrictEqual(first.result?.openFlagsToKernel, { directIo: false, keepCache: false, nonSeekable: false });
      });

      it("should only open the virtual file", async () => {
        const { serverInterface } = createTestServerInterface();

        const response = await serverInterface.open({ ...requestBase, opcode: "OPEN", nodeId: 1n, flags: 0n });

        assert.deepStrictEqual(response, { forOpcode: "OPEN", errorCode: ENOENT, result: undefined });
      });

      it("should read from the block device", async () => {
        const { blockDevice } = createFakeBlockDevice();
        const { serverInterface } = createTestServerInterface({ blockDevice });

        const response = await serverInterface.read({
          ...requestBase, opcode: "READ", nodeId: 2n, fh: 1n, offset: 512n, size: 4n, readFlags: 0n, lockOwner: 0n,
        });

        assert.deepStrictEqual(response, { forOpcode: "READ", errorCode: undefined, result: { data: Uint8Array.from([0, 1, 2, 3]) } });
      });

      it("should write to the block device", async () => {
        const fakeBlockDevice = createFakeBlockDevice();
        const { serverInterface } = createTestServerInterface({ blockDevice: fakeBlockDevice.blockDevice });
        const data = Uint8Array.from([7, 8, 9]);

        const response = await serverInterface.write({
          ...requestBase, opcode: "WRITE", nodeId: 2n, fh: 1n, offset: 1024n, data, writeFlags: 0n, lockOwner: 0n,
        });

        assert.deepStrictEqual(response, { forOpcode: "WRITE", errorCode: undefined, result: { bytesWritten: 3n } });
        assert.deepStrictEqual(fakeBlockDevice.writes(), [{ offset: 1024n, data }]);
      });

      [
        { description: "without block device", blockDevice: undefined, log: "error: read without block device" },
        {
          description: "if the block device fails",
          blockDevice: createFakeBlockDevice({ failing: true }).blockDevice,
          log: "error: Error: remote failure",
        },
      ].forEach(({ description, blockDevice, log }) => {
        it(`should fail reads ${description}`, async () => {
          const { serverInterface, recordingLogger } = createTestServerInterface({ blockDevice });

          const response = await serverInterface.read({
            ...requestBase, opcode: "READ", nodeId: 2n, fh: 1n, offset: 0n, size: 4n, readFlags: 0n, lockOwner: 0n,
          });

          assert.deepStrictEqual(response, { forOpcode: "READ", errorCode: EIO, result: undefined });
          assert.deepStrictEqual(recordingLogger.lines(), [log]);
        });

        it(`should fail writes ${description}`, async () => {
          const { serverInterface, recordingLogger } = createTestServerInterface({ blockDevice });

          const response = await serverInterface.write({
            ...requestBase, opcode: "WRITE", nodeId: 2n, fh: 1n, offset: 0n, data: Uint8Array.from([1]), writeFlags: 0n, lockOwner: 0n,
          });

          assert.deepStrictEqual(response, { forOpcode: "WRITE", errorCode: EIO, result: undefined });
          assert.deepStrictEqual(recordingLogger.lines(), [log.replace("read", "write")]);
        });
      });

    });

    describe("handles and directory", () => {
      it("should accept fsync, release and releasedir", async () => {
        const { serverInterface } = createTestServerInterface();

        const fsync = await serverInterface.fsync({ ...requestBase, opcode: "FSYNC", nodeId: 2n, fh: 1n, fsyncFlags: 0n });
        const release = await serverInterface.release({
          ...requestBase, opcode: "RELEASE", nodeId: 2n, fh: 1n, flags: 0n, releaseFlags: 0n, lockOwner: 0n,
        });
        const releasedir = await serverInterface.releasedir({
          ...requestBase, opcode: "RELEASEDIR", nodeId: 1n, fh: 0n, flags: 0n, releaseFlags: 0n, lockOwner: 0n,
        });

        assert.deepStrictEqual([fsync, release, releasedir].map((response) => {
          return response.errorCode;
        }), [undefined, undefined, undefined]);
      });

      it("should only open the root directory as directory", async () => {
        const { serverInterface } = createTestServerInterface();

        const root = await serverInterface.opendir({ ...requestBase, opcode: "OPENDIR", nodeId: 1n, flags: 0n });
        const virtualFile = await serverInterface.opendir({ ...requestBase, opcode: "OPENDIR", nodeId: 2n, flags: 0n });

        assert.strictEqual(root.errorCode, undefined);
        assert.deepStrictEqual(virtualFile, { forOpcode: "OPENDIR", errorCode: ENOTDIR, result: undefined });
      });

      [
        { offset: 0n, size: 4096n, names: [".", "..", "virtual"] },
        { offset: 2n, size: 4096n, names: ["virtual"] },
        { offset: 0n, size: 32n, names: ["."] },
      ].forEach(({ offset, size, names }) => {
        it(`should list ${names.join(", ")} from offset ${offset} with ${size} bytes`, async () => {
          const { serverInterface } = createTestServerInterface();

          const response = await serverInterface.readdir({
            ...requestBase, opcode: "READDIR", nodeId: 1n, fh: 0n, offset, size, readFlags: 0n, lockOwner: 0n, flags: 0n,
          });

          const allEntries = [
            { inode: 1n, nextOffset: 1n, fileType: "DT_DIR" as const, name: "." },
            { inode: 1n, nextOffset: 2n, fileType: "DT_DIR" as const, name: ".." },
            { inode: 2n, nextOffset: 3n, fileType: "DT_REG" as const, name: "virtual" },
          ];
          const entries = allEntries.filter(({ name }) => {
            return names.includes(name);
          });
          assert.deepStrictEqual(response.result?.data, direntsToBuffer({ entries, maxLength: 4096 }));
        });
      });

    });

    describe("other operations", () => {
      it("should report the filesystem statistics libfuse reports by default", async () => {
        const { serverInterface } = createTestServerInterface();

        const response = await serverInterface.statfs({ ...requestBase, opcode: "STATFS" });

        assert.strictEqual(response.result?.bsize, 512n);
        assert.strictEqual(response.result?.namelen, 255n);
      });

      it("should accept being destroyed", async () => {
        const { serverInterface } = createTestServerInterface();

        const response = await serverInterface.destroy({ ...requestBase, opcode: "DESTROY" });

        assert.deepStrictEqual(response, { forOpcode: "DESTROY", errorCode: undefined, result: {} });
      });

      notImplementedMethods.forEach((method) => {
        it(`should not implement ${method}`, async () => {
          const { serverInterface } = createTestServerInterface();

          const response = await (serverInterface[method] as () => Promise<unknown>)();

          assert.strictEqual((response as { errorCode: number }).errorCode, ENOSYS);
        });
      });
    });
  });

  describe("createFuseVirtualFile", () => {
    it("should mount the filesystem detached and open the virtual file on it", async () => {
      const { system, mockFuse, filesystem } = createMockSystem();

      const virtualFile = await createFuseVirtualFile({ system });

      assert.deepStrictEqual(mockFuse.mountOptions(), [{
        requiredOptions: { rootmode: 0o40_000, user_id: 0, group_id: 0 },
        otherOptions: {},
        mountAttributes: { MOUNT_ATTR_NOSUID: true, MOUNT_ATTR_NODEV: true, MOUNT_ATTR_NOEXEC: true },
      }]);
      assert.deepStrictEqual(filesystem.openedPaths(), ["/proc/4242/fd/10/virtual", `/proc/4242/fd/${virtualFile.fd}`]);
    });

    it("should close the mount and a second handle of the virtual file", async () => {
      const { system, filesystem } = createMockSystem();

      const virtualFile = await createFuseVirtualFile({ system });

      assert.deepStrictEqual(filesystem.closedFds(), [10, virtualFile.fd + 1]);
    });

    it("should link the virtual file for debugging", async () => {
      const { system, filesystem } = createMockSystem();
      await system.fs.promises.symlink("/old/target", "/tmp/fuse-block-debug");

      const virtualFile = await createFuseVirtualFile({ system });

      assert.strictEqual(filesystem.symlinkTarget({ path: "/tmp/fuse-block-debug" }), `/proc/4242/fd/${virtualFile.fd}`);
    });

    it("should serve the assigned block device and refresh its attributes", async () => {
      const { system, mockFuse, filesystem } = createMockSystem();
      const virtualFile = await createFuseVirtualFile({ system });

      await virtualFile.assign({ blockDevice: createFakeBlockDevice().blockDevice });
      const response = await mockFuse.request({
        opcode: "READ",
        request: { nodeId: 2n, fh: 1n, offset: 0n, size: 2n, readFlags: 0n, lockOwner: 0n },
      });

      assert.strictEqual(filesystem.statCalls(), 1);
      assert.deepStrictEqual(response, { forOpcode: "READ", unique: 1n, errorCode: undefined, result: { data: Uint8Array.from([0, 1]) } });
    });

    it("should abort the fuse connection", async () => {
      const { system, mockFuse } = createMockSystem();
      const virtualFile = await createFuseVirtualFile({ system });

      virtualFile.abort();

      assert.strictEqual(mockFuse.isClosed(), true);
    });

    it("should abort the fuse connection and close the virtual file when closing", async () => {
      const { system, mockFuse, filesystem } = createMockSystem();
      const virtualFile = await createFuseVirtualFile({ system });

      await virtualFile.close();

      assert.strictEqual(mockFuse.isClosed(), true);
      assert.strictEqual(filesystem.closedFds().at(-1), virtualFile.fd);
    });

    it("should abort the fuse connection only once", async () => {
      const { system, filesystem } = createMockSystem();
      const virtualFile = await createFuseVirtualFile({ system });

      virtualFile.abort();
      virtualFile.abort();
      await virtualFile.close();

      assert.strictEqual(filesystem.closedFds().at(-1), virtualFile.fd);
    });

    it("should fail if the fuse device cannot be opened", async () => {
      const { system, mockFuse } = createMockSystem();
      mockFuse.failOpen({ error: Error("failed to open \"/dev/fuse\"") });

      await assert.rejects(createFuseVirtualFile({ system }), Error("failed to open \"/dev/fuse\""));
    });

    it("should close the filesystem if it cannot be mounted", async () => {
      const { system, mockFuse } = createMockSystem();
      mockFuse.failMount({ error: Error("fsopen syscall failed with errno 1") });

      await assert.rejects(createFuseVirtualFile({ system }), Error("fsopen syscall failed with errno 1"));
      assert.strictEqual(mockFuse.isClosed(), true);
    });

    it("should close the mount and abort the fuse connection if the virtual file cannot be opened", async () => {
      const { system, mockFuse, filesystem } = createMockSystem();
      const failingSystem = {
        ...system,
        fs: {
          ...system.fs,
          promises: {
            ...system.fs.promises,
            open: async () => {
              throw Error("ENOENT");
            },
          },
        },
      };

      await assert.rejects(createFuseVirtualFile({ system: failingSystem }), Error("ENOENT"));
      assert.deepStrictEqual(filesystem.closedFds(), [10]);
      assert.strictEqual(mockFuse.isClosed(), true);
    });

    it("should abort the fuse connection and close the virtual file if it cannot be prepared", async () => {
      const { system, mockFuse, filesystem } = createMockSystem();
      const failingSystem = {
        ...system,
        fs: {
          ...system.fs,
          promises: {
            ...system.fs.promises,
            symlink: async () => {
              throw Error("EROFS");
            },
          },
        },
      };

      await assert.rejects(createFuseVirtualFile({ system: failingSystem }), Error("EROFS"));
      assert.strictEqual(mockFuse.isClosed(), true);
      assert.deepStrictEqual(filesystem.openedPaths(), ["/proc/4242/fd/10/virtual", "/proc/4242/fd/21"]);
      assert.deepStrictEqual(filesystem.closedFds(), [10, 22, 21]);
    });
  });
});
