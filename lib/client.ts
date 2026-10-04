import WebSocket from "isomorphic-ws";
import { createWebSocketBinaryJrpc } from "./jrpc/websocket.ts";
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

const createClient = ({ url, blockDevice }: { url: string, blockDevice: TBlockDevice }) => {
  // eslint-disable-next-line k13-engineering/no-new
  const client = new WebSocket(url);

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
    socket: client,

    handleNotification: async () => {
      // console.log("notification", { method, params });
    },

    handleRequest: async (req) => {
      // console.log("request", req);

      const handler = requestHandlers[req.method as keyof typeof requestHandlers];
      if (handler === undefined) {
        throw Error(`Unknown method: ${req.method}`);
      }

      // @ts-expect-error types
      const result = await handler(req);

      // console.log("result", result);

      return result;
    },

    onConnectionError: ({ error }) => {
      console.error(`Connection error: ${error.message}`);
    },

    onRemoteClose: () => {
      console.log("Remote closed the connection");
    }
  });

  client.on("open", () => {
    console.log("Connected");
  });

  client.on("close", () => {
    console.log("Connection closed");
  });

  client.on("error", (error: Error) => {
    console.error(`Error: ${error.message}`);
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
