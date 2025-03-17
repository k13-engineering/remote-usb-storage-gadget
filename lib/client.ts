import WebSocket from "isomorphic-ws";
import { createWebSocketJrpc } from "../../yajrpc/lib/websocket.ts";
import type { TRequestMaybeResponse } from "../../yajrpc/lib/index.ts";

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
    data: Uint8Array;
  }
} | {
  method: "queryGeometry",
};

const createClient = ({ url, blockDevice }: { url: string, blockDevice: TBlockDevice }) => {
  const client = new WebSocket(url);

  const handleReadRequest = async (request: Extract<TBlockDeviceJrpcRequest, { method: "read" }>): Promise<TRequestMaybeResponse> => {

    const { offset, length } = request.params;

    const data = await blockDevice.read({ offset: BigInt(offset), length });

    return {
      result: {
        data
      }
    };
  };

  const handleWriteRequest = async (request: Extract<TBlockDeviceJrpcRequest, { method: "write" }>): Promise<TRequestMaybeResponse> => {

    const { offset, data } = request.params;

    await blockDevice.write({ offset: BigInt(offset), data });

    return {
      result: {

      }
    };
  };

  const handleQueryGeometryRequest = async (): Promise<TRequestMaybeResponse> => {

    const { geometry } = await blockDevice.queryGeometry();

    return {
      result: {
        geometry
      }
    };
  };

  const requestHandlers: {
    [key in TBlockDeviceJrpcRequest["method"]]: (arg: Extract<TBlockDeviceJrpcRequest, "method">) => Promise<TRequestMaybeResponse>
  } = {
    read: handleReadRequest,
    write: handleWriteRequest,
    queryGeometry: handleQueryGeometryRequest
  };

  createWebSocketJrpc({
    socket: client,

    handleNotification: async ({ method, params }) => {
      console.log("notification", { method, params });
    },

    handleRequest: async (req) => {
      console.log("request", req);

      const handler = requestHandlers[req.method as keyof typeof requestHandlers];
      if (handler === undefined) {
        throw new Error(`Unknown method: ${req.method}`);
      }

      return await handler(req);

      return {
        ignore: true
      };
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
