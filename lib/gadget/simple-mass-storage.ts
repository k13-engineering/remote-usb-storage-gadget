import nodePath from "node:path";
import { createGadgetViaConfigfs } from "./configfs.ts";
import { realSystem, type TSystem } from "../system.ts";

type TSimpleMassStorageGadgetConfig = {
  idVendor: number;
  idProduct: number;
  bcdDevice: number;
  bcdUSB: number;

  strings: {
    "0x409": {
      serialnumber: string;
      manufacturer: string;
      product: string;
    }
  },
};

const createSimpleMassStorageGadget = ({
  gadgetName,
  massStorageConfig,
  system = realSystem,
}: {
  gadgetName: string;
  massStorageConfig: TSimpleMassStorageGadgetConfig;
  system?: TSystem;
}) => {
  const gadgetConfigfs = createGadgetViaConfigfs({
    system,
    gadgetName,
    gadgetConfig: {
      idVendor: massStorageConfig.idVendor,
      idProduct: massStorageConfig.idProduct,
      bcdDevice: massStorageConfig.bcdDevice,
      bcdUSB: massStorageConfig.bcdUSB,

      strings: massStorageConfig.strings,

      functions: {
        "mass_storage.0": {}
      },

      configs: {
        "c.1": {
          functions: ["mass_storage.0"],
          strings: {
            "0x409": {
              configuration: "Mass Storage"
            }
          },
          bmAttributes: 0x80,
          MaxPower: 0
        }
      }
    }
  });

  const massStorageFunction = gadgetConfigfs.functionPathsByNames["mass_storage.0"];

  const assignLogicalUnitByFd = async ({ fd }: { fd: number }) => {

    const virtualFilePath = `/proc/${system.pid}/fd/${fd}`;

    const configfsBackingFilePath = nodePath.join(massStorageFunction, "lun.0/file");

    // asynchronously, as the kernel opens the file, which is served by the event loop of this process
    await system.fs.promises.writeFile(configfsBackingFilePath, virtualFilePath);
  };

  const enable = ({ udc }: { udc: string }) => {
    gadgetConfigfs.enable({ udc });
  };

  const disable = () => {
    gadgetConfigfs.disable();
  };

  return {
    assignLogicalUnitByFd,

    enable,
    disable
  };
};

export {
  createSimpleMassStorageGadget
};
