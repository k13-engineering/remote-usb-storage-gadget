import { createBlockDeviceFromFilePath } from "./block/blockdev-from-file.ts";
import { createClient } from "./client.ts";
import { createUsbGadgetServer } from "./server.ts";
import { createStorageGadget } from "./storage-gadget.ts";
import type { TBlockDevice, TBlockDeviceGeometry } from "./client.ts";
import type { TStorageGadget, TStorageGadgetAttachment } from "./storage-gadget.ts";

export {
  createBlockDeviceFromFilePath,
  createClient,
  createStorageGadget,
  createUsbGadgetServer,
};

export type {
  TBlockDevice,
  TBlockDeviceGeometry,
  TStorageGadget,
  TStorageGadgetAttachment,
};
