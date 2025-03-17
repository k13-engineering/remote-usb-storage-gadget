import { WebSocketServer } from "ws";
import { createUsbGadgetServer } from "../lib/server.ts";
import { createStorageGadget } from "../lib/storage-gadget.ts";

const storageGadget = createStorageGadget();

const gadgetServer = createUsbGadgetServer({ storageGadget });
const server = new WebSocketServer({ port: 8080 });

server.on("connection", (socket, req) => {
  gadgetServer.serve({ socket, req });
});
