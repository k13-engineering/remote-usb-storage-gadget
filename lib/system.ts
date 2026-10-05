import nodeFs from "node:fs";
import nodeProcess from "node:process";
import { createFuseFileSystem, openFuseFd } from "@k13engineering/linux-fuse";

type TLogger = Pick<typeof console, "log" | "error">;

// everything that touches the real system goes through this object, so it can be mocked in tests
type TSystem = {
  fs: Pick<
    typeof nodeFs,
    "closeSync" | "mkdirSync" | "readdirSync" | "readFileSync" | "rmdirSync" | "statfsSync" | "statSync" |
    "symlinkSync" | "unlinkSync" | "writeFileSync"
  > & {
    promises: Pick<typeof nodeFs.promises, "open" | "rm" | "symlink" | "writeFile">;
  };

  fuse: {
    openFuseFd: typeof openFuseFd;
    createFuseFileSystem: typeof createFuseFileSystem;
  };

  logger: TLogger;

  pid: number;
};

const realSystem: TSystem = {
  fs: nodeFs,

  fuse: {
    openFuseFd,
    createFuseFileSystem,
  },

  logger: console,

  pid: nodeProcess.pid,
};

export {
  realSystem,
};

export type {
  TLogger,
  TSystem,
};
