import type { TBlockDevice } from "./client.ts";
import { createFuseVirtualFile, type TFuseVirtualFile } from "./fuse-virtual-file.ts";
import { createSimpleMassStorageGadget } from "./gadget/simple-mass-storage.ts";
import { realSystem, type TSystem } from "./system.ts";

const createStorageGadget = async ({
  udc,

  idVendor,
  idProduct,
  bcdDevice,

  manufacturer,
  product,
  serialnumber,

  system = realSystem,
}: {
  udc: string,

  idVendor: number;
  idProduct: number;
  bcdDevice: number;

  manufacturer: string;
  product: string;
  serialnumber: string;

  system?: TSystem;
}) => {

  let attachedBlockDevice: TBlockDevice | undefined = undefined;
  const simpleMassStorageGadget = createSimpleMassStorageGadget({
    system,
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

  simpleMassStorageGadget.disable();

  // attachedBlockDevice is set synchronously when attaching starts, so concurrent attaches fail instead of racing
  const releaseAttachment = () => {
    attachedBlockDevice = undefined;
  };

  // detaching aborts the virtual file for good, so each attachment gets its own
  const bindVirtualFile = async ({ blockDevice }: { blockDevice: TBlockDevice }) => {
    const virtualFile = await createFuseVirtualFile({ system });

    try {
      system.logger.log("assigning logical unit");

      await virtualFile.assign({ blockDevice });
      await simpleMassStorageGadget.assignLogicalUnitByFd({ fd: virtualFile.fd });
      simpleMassStorageGadget.enable({ udc });
    } catch (ex) {
      await virtualFile.close();
      throw ex;
    }

    return virtualFile;
  };

  const attach = async ({ blockDevice }: { blockDevice: TBlockDevice }) => {
    if (attachedBlockDevice !== undefined) {
      throw Error("already attached");
    }

    attachedBlockDevice = blockDevice;

    let virtualFile: TFuseVirtualFile;

    try {
      virtualFile = await bindVirtualFile({ blockDevice });
    } catch (ex) {
      // nothing got attached, so the next client can try again
      releaseAttachment();
      throw ex;
    }

    let detached = false;

    const detach = async () => {
      if (detached) {
        throw Error("already detached");
      }

      detached = true;

      // unbinding waits for the mass storage thread, which may itself wait for the reply to a request to the
      // virtual file. This process cannot reply while it is blocked in unbinding, so the fuse connection is
      // aborted first, then the kernel fails such requests without a reply
      system.logger.log("aborting virtual file");
      virtualFile.abort();

      system.logger.log("disabling mass storage");
      simpleMassStorageGadget.disable();

      system.logger.log("disable done");

      await virtualFile.close();
      releaseAttachment();
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
