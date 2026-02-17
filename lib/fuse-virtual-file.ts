// @ts-expect-error missing types
import Fuse from "fuse-native";
import nodeFs from "node:fs";
import nodeChildProcess from "node:child_process";
import type { TBlockDevice } from "./client.ts";

// eslint-disable-next-line max-statements
const createFuseVirtualFile = async () => {

  const virtualFileName = "virtual";

  const uid = 0;
  const gid = 0;

  let fdCounter = 1;

  let blockDevice: TBlockDevice | undefined = undefined;

  const getattrHandlersByPath: { [key: string]: (args: { path: string }) => Promise<unknown> } = {
    "/": async () => {
      return {
        mtime: new Date(),
        atime: new Date(),
        ctime: new Date(),
        nlink: 1,
        size: 100,
        mode: 16877,
        uid,
        gid
      };
    },

    [`/${virtualFileName}`]: async () => {
      // TODO: exceptions

      let totalBytes = 0;

      if (blockDevice !== undefined) {
        try {
          const geometry = await blockDevice.queryGeometry();
          totalBytes = Number(geometry.geometry.numberOfPhysicalBlocks) * geometry.geometry.physicalBlockSize;
        } catch (ex) {
          console.error(ex);
        }
      }

      return {
        mtime: new Date(),
        atime: new Date(),
        ctime: new Date(),
        nlink: 1,
        size: totalBytes,
        mode: 33188,
        uid,
        gid
      };
    }
  };

  const fuseOps = {
    // @ts-expect-error missing types
    readdir: function (path, cb) {
      // console.log('readdir(%s)', path)
      if (path === "/") {
        return cb(0, [virtualFileName]);
      }

      return cb(0);
    },

    // @ts-expect-error missing types
    getattr: async (path, cb) => {

      const handler = getattrHandlersByPath[path];
      if (handler !== undefined) {
        const result = await handler({ path });
        cb(0, result);
      }

      cb(Fuse.ENOENT);
    },

    // @ts-expect-error missing types
    open: function (path, flags, cb) {
      const fd = fdCounter;
      fdCounter += 1;
      cb(0, fd);
    },

    // @ts-expect-error missing types
    release: (path, fd, cb) => {
      cb(0);
    },

    // @ts-expect-error missing types
    // eslint-disable-next-line max-params
    read: (path, fd, buf, len, pos, cb) => {

      if (blockDevice === undefined) {
        console.error("no block device");
        cb(Fuse.EIO);
        return;
      }

      blockDevice.read({
        offset: BigInt(pos),
        length: len
      }).then((result) => {
        buf.set(result);
        cb(result.length);
      }, (err) => {
        console.error(err);
        cb(Fuse.EIO);
      });
    },

    // @ts-expect-error missing types
    // eslint-disable-next-line max-params
    write: (path, fd, buf, len, pos, cb) => {

      if (blockDevice === undefined) {
        console.error("no block device");
        cb(Fuse.EIO);
        return;
      }

      blockDevice.write({
        offset: BigInt(pos),
        data: buf.subarray(0, len)
      }).then(() => {
        cb(len);
      }, (err) => {
        console.error(err);
        cb(Fuse.EIO);
      });
    }
  };

  const mountPoint = "/tmp/gadget";

  const fuse = new Fuse(mountPoint, fuseOps, {
    // debug: true,
    force: true,
    mkdir: true,
    // options: ["direct_io"]
    // make sure attributes are never cached
    attrTimeout: "0",
  });

  await new Promise<void>((resolve, reject) => {
    fuse.mount((err: Error) => {
      if (err) {
        reject(err);
        return;
      }

      resolve();
    });
  });

  const fd = await new Promise<number>((resolve, reject) => {
    nodeFs.open(`${mountPoint}/${virtualFileName}`, "r+", (err, fdOpened) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(fdOpened);
    });
  });

  nodeChildProcess.execSync(`umount -l ${mountPoint}`);

  console.log("fd is", fd);

  const fuseBlockDebugLink = "/tmp/fuse-block-debug";
  await nodeFs.promises.rm(fuseBlockDebugLink, { force: true });
  await nodeFs.promises.symlink(`/proc/${process.pid}/fd/${fd}`, fuseBlockDebugLink);

  console.log(`fuse block device for debugging is available at ${fuseBlockDebugLink}`);

  const assign = async ({ blockDevice: newBlockDevice }: { blockDevice: TBlockDevice | undefined }) => {
    blockDevice = newBlockDevice;

    await new Promise<void>((resolve, reject) => {
      nodeFs.fstat(fd, (err) => {
        if (err) {
          reject(err);
          return;
        }

        resolve();
      });
    });
  };

  return {
    assign,

    fd
  };
};

export {
  createFuseVirtualFile
};
