import { createStorageGadget } from "../lib/storage-gadget.ts";
import type { TBlockDevice } from "../lib/client.ts";

const gadget = await createStorageGadget();

const dummyBlockDevice: TBlockDevice = {
  read: async ({ offset, length }) => {
    console.log(`read ${offset} ${length}`);
    return new Uint8Array(length);
  },

  write: async ({ offset, data }) => {
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

const handle = await gadget.attach({ blockDevice: dummyBlockDevice });

console.log("gadget ready");
