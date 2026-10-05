import type { IncomingMessage } from "http";
import type { WebSocket } from "ws";
import { createWebSocketBinaryJrpc } from "./jrpc/websocket.ts";
import type { TWebsocketBinaryJrpcHandle } from "./jrpc/websocket.ts";
import type { TBlockDevice } from "./client.ts";
import type { TStorageGadget, TStorageGadgetAttachment } from "./storage-gadget.ts";
import type { TLogger } from "./system.ts";

const createBlockDeviceViaJrpc = ({
  jrpc,
  connectionClosed,
}: {
  jrpc: TWebsocketBinaryJrpcHandle;
  connectionClosed: () => boolean;
}): TBlockDevice => {

  const request = async ({ method, params }: { method: string; params: Record<string, unknown> }) => {
    // the JRPC connection never answers requests made after it closed, so they would wait forever
    if (connectionClosed()) {
      throw Error(`${method} failed, the connection to the client is closed`);
    }

    const { error, response } = await jrpc.request({ method, params });
    if (error !== undefined) {
      throw error;
    }

    if (response.error !== undefined) {
      throw response.error;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return response.result as any;
  };

  const read: TBlockDevice["read"] = async ({ offset, length }) => {
    const result = await request({ method: "read", params: { offset, length } });
    return result.data.buffer.subarray(0, result.data.length());
  };

  const write: TBlockDevice["write"] = async ({ offset, data }) => {
    await request({ method: "write", params: { offset, data } });
  };

  const queryGeometry: TBlockDevice["queryGeometry"] = async () => {
    const result = await request({ method: "queryGeometry", params: {} });

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

    let closed = false;

    const remoteBlockDevice = createBlockDeviceViaJrpc({
      jrpc,
      connectionClosed: () => {
        return closed;
      },
    });
    let storageGadgetAttachment: TStorageGadgetAttachment | undefined = undefined;

    const detach = ({ attachment }: { attachment: TStorageGadgetAttachment }) => {
      attachment.detach().catch((error: Error) => {
        logger.error(`failed to detach the block device of the client: ${error.message}`);
      });
    };

    storageGadget.attach({ blockDevice: remoteBlockDevice }).then((attachment) => {
      storageGadgetAttachment = attachment;
      if (closed) {
        detach({ attachment });
      }
    }, (error: Error) => {
      logger.error(`failed to attach the block device of the client: ${error.message}`);
      socket.close();
    });

    socket.on("error", (error: Error) => {
      logger.error(`Error: ${error.message}`);
    });

    socket.on("close", () => {
      closed = true;
      logger.log("Connection closed");

      if (storageGadgetAttachment !== undefined) {
        detach({ attachment: storageGadgetAttachment });
      }
    });
  };

  return {
    serve
  };
};

export {
  createUsbGadgetServer
};
