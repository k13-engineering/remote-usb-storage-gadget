import type WebSocket from "isomorphic-ws";
import { createWebSocketBinaryJrpc } from "./jrpc/websocket.ts";
import type { TLogger } from "./system.ts";
import type { TRequestResponse } from "@k13engineering/yajrpc";
import type { Binary } from "bson";

type TBlockDeviceGeometry = {
  physicalBlockSize: number;
  numberOfPhysicalBlocks: bigint;
};

type TBlockDevice = {
  read: (args: { offset: bigint, length: number }) => Promise<Uint8Array>;
  write: (args: { offset: bigint, data: Uint8Array }) => Promise<void>;
  queryGeometry: () => Promise<{ geometry: TBlockDeviceGeometry }>;
};

type TBlockDeviceJrpcRequest = {
  method: "read",
  params: {
    offset: number;
    length: number;
  }
} | {
  method: "write",
  params: {
    offset: number;
    data: Binary;
  }
} | {
  method: "queryGeometry",
};

// see the JSON-RPC 2.0 specification
const JSON_RPC_METHOD_NOT_FOUND = -32601;
const JSON_RPC_SERVER_ERROR = -32000;

const createClient = ({
  socket,
  blockDevice,
  logger = console,
}: {
  socket: WebSocket;
  blockDevice: TBlockDevice;
  logger?: TLogger;
}) => {

  const handleReadRequest = async (request: Extract<TBlockDeviceJrpcRequest, { method: "read" }>): Promise<TRequestResponse> => {

    const { offset, length } = request.params;

    const data = await blockDevice.read({ offset: BigInt(offset), length });

    return {
      error: undefined,
      result: {
        data
      }
    };
  };

  const handleWriteRequest = async (request: Extract<TBlockDeviceJrpcRequest, { method: "write" }>): Promise<TRequestResponse> => {

    const { offset, data } = request.params;
    const dataAsUint8Array = data.buffer.subarray(0, data.length());

    await blockDevice.write({ offset: BigInt(offset), data: dataAsUint8Array });

    return {
      error: undefined,
      result: {

      }
    };
  };

  const handleQueryGeometryRequest = async (): Promise<TRequestResponse> => {

    const { geometry } = await blockDevice.queryGeometry();

    return {
      error: undefined,
      result: {
        geometry: {
          physicalBlockSize: geometry.physicalBlockSize,
          numberOfPhysicalBlocks: Number(geometry.numberOfPhysicalBlocks)
        }
      }
    };
  };

  const requestHandlers: {
    [key in TBlockDeviceJrpcRequest["method"]]: (arg: Extract<TBlockDeviceJrpcRequest, "method">) => Promise<TRequestResponse>
  } = {
    read: handleReadRequest,
    write: handleWriteRequest,
    queryGeometry: handleQueryGeometryRequest
  };

  createWebSocketBinaryJrpc({
    socket,

    handleNotification: async () => {
      // console.log("notification", { method, params });
    },

    handleRequest: async (req) => {
      if (!Object.hasOwn(requestHandlers, req.method)) {
        return { error: { code: JSON_RPC_METHOD_NOT_FOUND, message: `Unknown method: ${req.method}` }, result: undefined };
      }

      const handler = requestHandlers[req.method as keyof typeof requestHandlers];

      // the server waits for every response, so failures are reported instead of thrown
      try {
        // @ts-expect-error types
        return await handler(req);
      } catch (ex) {
        logger.error(`${req.method} request failed`, ex);
        return { error: { code: JSON_RPC_SERVER_ERROR, message: `${req.method} failed: ${(ex as Error).message}` }, result: undefined };
      }
    },

    onConnectionError: ({ error }) => {
      logger.error(`Connection error: ${error.message}`);
    },

    onRemoteClose: () => {
      logger.log("Remote closed the connection");
    }
  });

  socket.on("open", () => {
    logger.log("Connected");
  });

  socket.on("close", () => {
    logger.log("Connection closed");
  });

  socket.on("error", (error: Error) => {
    logger.error(`Error: ${error.message}`);
  });

  return {

  };
};

export type {
  TBlockDevice,
  TBlockDeviceGeometry
};

export {
  createClient
};
