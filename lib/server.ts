import type { IncomingMessage } from "http";
import type { WebSocket } from "ws";
import { createWebSocketJrpc } from "./jrpc/websocket.ts";
import type { TWebsocketJrpcHandle } from "./jrpc/websocket.ts";
import type { TBlockDevice } from "./client.ts";
import type { TStorageGadget } from "./storage-gadget.ts";

const createBlockDeviceViaJrpc = ({ jrpc }: { jrpc: TWebsocketJrpcHandle }): TBlockDevice => {

  return {};
};

const createUsbGadgetServer = ({ storageGadget }: { storageGadget: TStorageGadget }) => {

  let remoteBlockDevice: TBlockDevice | undefined = undefined;

  const serve = ({ socket, req }: { socket: WebSocket, req: IncomingMessage }) => {

    console.log(`incoming connection from ${req.socket.remoteAddress}:${req.socket.remotePort}`);

    const jrpc = createWebSocketJrpc({
      socket,

      handleNotification: async ({ method, params }) => {
        console.log("notification", { method, params });
      },

      handleRequest: async ({ method, params }) => {
        console.log("request", { method, params });

        return {
          ignore: true
        };
      }
    });

    if (remoteBlockDevice !== undefined) {

      console.log("rejecting connection, another client is already connected");

      jrpc.notify({
        method: "error",
        params: {
          message: "another client is already connected"
        }
      });
      socket.close();
      return;
    }

    remoteBlockDevice = createBlockDeviceViaJrpc({ jrpc });

    console.log("requesting geometry");
    jrpc.request({ method: "queryGeometry", params: {} }).then((response) => {
      console.log("queryGeometry response", response);
    });

    socket.on("message", (message: string) => {
      console.log(`Received message: ${message}`);
    });

    socket.on("error", (error: Error) => {
      console.error(`Error: ${error.message}`);
    });

    socket.on("close", () => {
      console.log("Connection closed");
      remoteBlockDevice = undefined;
    });
  };

  return {
    serve
  };
};

export {
  createUsbGadgetServer
};
