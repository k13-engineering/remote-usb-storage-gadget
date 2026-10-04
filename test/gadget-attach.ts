import { createStorageGadget } from "../lib/storage-gadget.ts";
import type { TBlockDevice } from "../lib/client.ts";

const gadget = await createStorageGadget({
  udc: "fcc00000.usb",

  idVendor: 0x27df,
  idProduct: 0x16c0,
  bcdDevice: 0x0100,

  manufacturer: "k13 engineering GmbH",
  product: "Remote USB Storage Gadget",
  serialnumber: "0001"
});

const dummyBlockDevice: TBlockDevice = {
  read: async ({ offset, length }) => {
    console.log(`read ${offset} ${length}`);
    return new Uint8Array(length);
  },

  write: async () => {
    throw Error("not implemented yet");
  },

  queryGeometry: async () => {
    return {
      geometry: {
        physicalBlockSize: 512,
        numberOfPhysicalBlocks: BigInt(1024 * 1024)
      }
    };
  }
};

await gadget.attach({ blockDevice: dummyBlockDevice });

console.log("gadget ready");
