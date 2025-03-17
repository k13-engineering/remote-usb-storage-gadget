import Fuse from "fuse-native";
import nodeFs from "node:fs";
import nodeChildProcess from "node:child_process";
import type { TBlockDevice } from "./client.ts";

const createFuseVirtualFile = async ({ blockDevice }: { blockDevice: TBlockDevice }) => {

  const virtualFileName = "virtual";

  const uid = 0;
  const gid = 0;

  const fuseOps = {
    readdir: function (path, cb) {
      console.log('readdir(%s)', path)
      if (path === "/") {
        return cb(0, [virtualFileName]);
      }

      return cb(0);
    },
    /*
    access: function (path, cb) {
      return process.nextTick(cb, 0)
    },
    */
    getattr: (path: string, cb: any) => {
      if (path === "/") {
        cb(0, {
          mtime: new Date(),
          atime: new Date(),
          ctime: new Date(),
          nlink: 1,
          size: 100,
          mode: 16877,
          uid,
          gid
        });

        return;
      }

      if (path === `/${virtualFileName}`) {
        cb(0, {
          mtime: new Date(),
          atime: new Date(),
          ctime: new Date(),
          nlink: 1,
          size: 12,
          mode: 33188,
          uid,
          gid
        });

        return;
      }

      cb(Fuse.ENOENT);
    },
    open: function (path, flags, cb) {
      console.log('open(%s, %d)', path, flags)
      return process.nextTick(cb, 0, 42) // 42 is an fd
    },
    release: (path, fd, cb) => {
      cb(0);
    },

    read: (path, fd, buf, len, pos, cb) => {
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
    }
  };

  const mountPoint = "/tmp/gadget";

  const fuse = new Fuse(mountPoint, fuseOps, {
    debug: true,
    force: true,
    mkdir: true,
  });

  await new Promise<void>((resolve, reject) => {
    fuse.mount((err: any) => {
      if (err) {
        reject(err);
        return;
      }

      resolve();
    });
  });

  const fd = await new Promise<number>((resolve, reject) => {
    nodeFs.open(`${mountPoint}/${virtualFileName}`, "r+", (err, fd) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(fd);
    });
  });

  nodeChildProcess.execSync(`umount -l ${mountPoint}`);

  console.log("fd is", fd);

  return {
    fd
  };
};

export {
  createFuseVirtualFile
};
