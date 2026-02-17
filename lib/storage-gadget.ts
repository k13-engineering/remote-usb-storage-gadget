import type { TBlockDevice } from "./client.ts";
import { createFuseVirtualFile } from "./fuse-virtual-file.ts";
import { createSimpleMassStorageGadget } from "./gadget/simple-mass-storage.ts";

const createStorageGadget = async ({
  udc,

  idVendor,
  idProduct,
  bcdDevice,

  manufacturer,
  product,
  serialnumber

}: {
  udc: string,

  idVendor: number;
  idProduct: number;
  bcdDevice: number;

  manufacturer: string;
  product: string;
  serialnumber: string;
}) => {

  let attachedBlockDevice: TBlockDevice | undefined = undefined;
  const simpleMassStorageGadget = createSimpleMassStorageGadget({
    gadgetName: "mygadget",
    massStorageConfig: {
      idVendor,
      idProduct,
      bcdDevice,
      bcdUSB: 0x0200,

      strings: {
        "0x409": {
          manufacturer,
          product,
          serialnumber
        }
      },
    }
  });

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
