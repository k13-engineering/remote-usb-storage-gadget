import type { TBlockDevice } from "./client.ts";
import { createFuseVirtualFile } from "./fuse-virtual-file.ts";
import { createSimpleMassStorageGadget } from "./gadget/simple-mass-storage.ts";

const createStorageGadget = async () => {

  let attachedBlockDevice: TBlockDevice | undefined = undefined;
  const simpleMassStorageGadget = createSimpleMassStorageGadget({
    gadgetName: "mygadget",
    massStorageConfig: {
      idVendor: 0x1234,
      idProduct: 0x5678,
      bcdDevice: 0x0100,
      bcdUSB: 0x0200,

      strings: {
        "0x409": {
          manufacturer: "Acme",
          product: "USB Gadget",
          serialnumber: "123456"
        }
      },
    }
  });

  const udc = "fcc00000.usb";

  const virtualFile = await createFuseVirtualFile();
  simpleMassStorageGadget.disable();

  const attach = async ({ blockDevice }: { blockDevice: TBlockDevice }) => {
    if (attachedBlockDevice !== undefined) {
      throw Error("already attached");
    }

    attachedBlockDevice = blockDevice;

    console.log("assigning logical unit");

    await virtualFile.assign({ blockDevice });
    await simpleMassStorageGadget.assignLogicalUnitByFd({ fd: virtualFile.fd });
    simpleMassStorageGadget.enable({ udc });

    let detached = false;

    const detach = async () => {
      if (detached) {
        throw Error("already detached");
      }

      console.log("disabling mass storage");
      simpleMassStorageGadget.disable();

      console.log("disable done");

      detached = true;
      attachedBlockDevice = undefined;
    };

    return {
      detach
    };
  };

  const status = () => {
    return {
      attached: attachedBlockDevice !== undefined,
    };
  };

  return {
    attach,

    status
  };
};

type TStorageGadget = Awaited<ReturnType<typeof createStorageGadget>>;
type TStorageGadgetAttachment = Awaited<ReturnType<TStorageGadget["attach"]>>;

export {
  createStorageGadget
};

export type {
  TStorageGadget,
  TStorageGadgetAttachment
};
