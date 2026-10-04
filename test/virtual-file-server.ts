import { WebSocketServer } from "ws";
import { createUsbGadgetServer } from "../lib/server.ts";
import type { TBlockDevice } from "../lib/client.ts";
import type { TStorageGadget } from "../lib/storage-gadget.ts";
import { createFuseVirtualFile } from "../lib/fuse-virtual-file.ts";

let activeBlockDevice: TBlockDevice | undefined = undefined;

const virtualFile = await createFuseVirtualFile();

const storageGadget: TStorageGadget = {
  attach: async ({ blockDevice }) => {
    activeBlockDevice = blockDevice;

    await virtualFile.assign({ blockDevice });

    const detach = async () => {
      await virtualFile.assign({ blockDevice: undefined });
      activeBlockDevice = undefined;
    };

    return {
      detach
    };
  },

  status: () => {
    return {
      attached: activeBlockDevice !== undefined,
    };
  }
};

const gadgetServer = createUsbGadgetServer({ storageGadget });
// eslint-disable-next-line k13-engineering/no-new
const server = new WebSocketServer({ port: 8080 });

// eslint-disable-next-line k13-engineering/prefer-single-object-parameters
server.on("connection", (socket, req) => {
  gadgetServer.serve({ socket, req });
});
