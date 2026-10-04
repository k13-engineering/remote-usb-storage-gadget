import { WebSocketServer } from "ws";
import { createUsbGadgetServer } from "../lib/server.ts";
import { createStorageGadget } from "../lib/storage-gadget.ts";

const udc = "fcc00000.usb";

const storageGadget = await createStorageGadget({
  udc,

  // https://github.com/obdev/v-usb/blob/master/usbdrv/USB-IDs-for-free.txt
  idVendor: 0x27df,
  idProduct: 0x16c0,
  bcdDevice: 0x0100,

  manufacturer: "k13 engineering GmbH",
  product: "Remote USB Storage Gadget",
  serialnumber: "0001"
});

const gadgetServer = createUsbGadgetServer({ storageGadget });
// eslint-disable-next-line k13-engineering/no-new
const server = new WebSocketServer({ port: 8080 });

// eslint-disable-next-line k13-engineering/prefer-single-object-parameters
server.on("connection", (socket, req) => {
  gadgetServer.serve({ socket, req });
});
