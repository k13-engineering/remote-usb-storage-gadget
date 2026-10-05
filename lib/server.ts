import type { IncomingMessage } from "http";
import type { WebSocket } from "ws";
import { createWebSocketBinaryJrpc } from "./jrpc/websocket.ts";
import type { TWebsocketBinaryJrpcHandle } from "./jrpc/websocket.ts";
import type { TBlockDevice } from "./client.ts";
import type { TStorageGadget, TStorageGadgetAttachment } from "./storage-gadget.ts";
import type { TLogger } from "./system.ts";

const createBlockDeviceViaJrpc = ({ jrpc }: { jrpc: TWebsocketBinaryJrpcHandle }): TBlockDevice => {

  const read: TBlockDevice["read"] = async ({ offset, length }) => {

    const { error, response } = await jrpc.request({ method: "read", params: { offset, length } });
    if (error !== undefined) {
      throw error;
    }

    if (response.error !== undefined) {
      throw response.error;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = response.result as any;
    return result.data.buffer.subarray(0, result.data.length());
  };

  const write: TBlockDevice["write"] = async ({ offset, data }) => {

    const { error, response } = await jrpc.request({ method: "write", params: { offset, data } });
    if (error !== undefined) {
      throw error;
    }

    if (response.error !== undefined) {
      throw response.error;
    }
  };

  const queryGeometry: TBlockDevice["queryGeometry"] = async () => {
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

const createUsbGadgetServer = ({ storageGadget, logger = console }: { storageGadget: TStorageGadget; logger?: TLogger }) => {

  const serve = ({ socket, req }: { socket: WebSocket, req: IncomingMessage }) => {

    logger.log(`incoming connection from ${req.socket.remoteAddress}:${req.socket.remotePort}`);

    const jrpc = createWebSocketBinaryJrpc({
      socket,

      handleNotification: async ({ method, params }) => {
        logger.log("notification", { method, params });
      },

      handleRequest: async ({ method, params }) => {
        logger.log("request", { method, params });

        return {
          error: undefined,
          result: undefined
        };
      },

      onConnectionError: ({ error }) => {
        logger.error(`Connection error: ${error.message}`);
      },

      onRemoteClose: () => {
        logger.log("Remote closed the connection");
      }
    });

    const status = storageGadget.status();
    if (status.attached) {
      logger.log("rejecting connection, another client is already connected");

      jrpc.notify({
        method: "error",
        params: {
          message: "another client is already connected"
        }
      });
      socket.close();
      return;
    }

    const remoteBlockDevice = createBlockDeviceViaJrpc({ jrpc });

    let closed = false;
    let storageGadgetAttachment: TStorageGadgetAttachment | undefined = undefined;

    storageGadget.attach({ blockDevice: remoteBlockDevice }).then((attachment) => {
      storageGadgetAttachment = attachment;
      if (closed) {
        storageGadgetAttachment.detach();
      }
    });

    socket.on("error", (error: Error) => {
      logger.error(`Error: ${error.message}`);
    });

    socket.on("close", () => {
      closed = true;
      logger.log("Connection closed");

      storageGadgetAttachment?.detach();
    });
  };

  return {
    serve
  };
};

export {
  createUsbGadgetServer
};
