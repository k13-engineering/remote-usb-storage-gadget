import { createGadgetViaConfigfs } from "../lib/gadget/configfs.ts";

const gadgetConfigfs = createGadgetViaConfigfs({
  gadgetName: "mygadget",
  gadgetConfig: {
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

console.log(gadgetConfigfs);
