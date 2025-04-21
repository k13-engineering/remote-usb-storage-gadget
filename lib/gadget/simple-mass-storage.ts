import { createGadgetViaConfigfs } from "./configfs.ts";
import nodeFs from "node:fs";
import nodePath from "node:path";

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
  massStorageConfig
}: {
  gadgetName: string;
  massStorageConfig: TSimpleMassStorageGadgetConfig;
}) => {
  const gadgetConfigfs = createGadgetViaConfigfs({
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

    const virtualFilePath = `/proc/${process.pid}/fd/${fd}`;

    const configfsBackingFilePath = nodePath.join(massStorageFunction, "lun.0/file");
    // nodeFs.writeFileSync(configfsBackingFilePath, virtualFilePath);

    await nodeFs.promises.writeFile(configfsBackingFilePath, virtualFilePath);
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
