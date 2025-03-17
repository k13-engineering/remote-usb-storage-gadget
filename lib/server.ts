import type { IncomingMessage } from "http";
import type { WebSocket } from "ws";
import { createWebSocketBinaryJrpc } from "./jrpc/websocket.ts";
import type { TWebsocketJrpcHandle } from "./jrpc/websocket.ts";
import type { TBlockDevice } from "./client.ts";
import type { TStorageGadget } from "./storage-gadget.ts";
import { createFuseVirtualFile } from "./fuse-virtual-file.ts";

const createBlockDeviceViaJrpc = ({ jrpc }: { jrpc: TWebsocketJrpcHandle }): TBlockDevice => {

  const read = async () => {
    throw Error("not implemented yet");
  };

  const write = async () => {
    throw Error("not implemented yet");
  };

  const queryGeometry = async () => {
    const { error, response } = await jrpc.request({ method: "queryGeometry", params: {} });
    if (error !== undefined) {
      throw error;
    }

    if (response.error !== undefined) {
      throw response.error;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = response.result as any;

    return {
      geometry: {
        physicalBlockSize: result.geometry.physicalBlockSize,
        numberOfPhysicalBlocks: BigInt(result.geometry.numberOfPhysicalBlocks)
      }
    };
  };

  return {
    read,
    write,
    queryGeometry
  };
};

const createUsbGadgetServer = ({ storageGadget }: { storageGadget: TStorageGadget }) => {

  let remoteBlockDevice: TBlockDevice | undefined = undefined;

  const pVirtualFile = createFuseVirtualFile({ blockDevice: {} });

  const serve = ({ socket, req }: { socket: WebSocket, req: IncomingMessage }) => {

    console.log(`incoming connection from ${req.socket.remoteAddress}:${req.socket.remotePort}`);

    const jrpc = createWebSocketBinaryJrpc({
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
    remoteBlockDevice.queryGeometry().then((result) => {
      console.log("queryGeometry result", result);
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
