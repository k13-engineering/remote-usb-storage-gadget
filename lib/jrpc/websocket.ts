import type WebSocket from "isomorphic-ws";
import { createWebSocketJrpc } from "@k13engineering/yajrpc";
import type { TWebSocketMessageParser } from "@k13engineering/yajrpc";
import { BSON } from "bson";
import type { TNotificationHandler, TRequestHandler } from "@k13engineering/yajrpc/dist/lib/types.js";

const createBsonParser = (): TWebSocketMessageParser => {

  const parse: TWebSocketMessageParser["parse"] = ({ data }) => {

    if (!(data instanceof Uint8Array)) {
      return {
        error: Error("unsupported WebSocket data type"),
      };
    }

    try {

      const message = BSON.deserialize(data);

      return {
        error: undefined,
        message
      };
    } catch (ex) {
      const error = ex as Error;
      return { error };
    }
  };

  const format: TWebSocketMessageParser["format"] = ({ message }) => {
    return BSON.serialize(message as Document);
  };

  return {
    parse,
    format
  };
};

const createWebSocketBinaryJrpc = ({
  socket,

  handleRequest,
  handleNotification,

  onConnectionError,
  onRemoteClose
}: {
  socket: WebSocket,

  handleRequest: TRequestHandler;
  handleNotification: TNotificationHandler;

  onConnectionError: ({ error }: { error: Error }) => void;
  onRemoteClose: () => void;
}) => {

  const parser = createBsonParser();

  return createWebSocketJrpc({
    // @ts-expect-error slightly different type signature, but compatible
    socket,
    handleRequest,
    handleNotification,
    parser,
    onConnectionError,
    onRemoteClose
  });
};

type TWebsocketBinaryJrpcHandle = ReturnType<typeof createWebSocketBinaryJrpc>;

export {
  createWebSocketBinaryJrpc
};

export type {
  TWebsocketBinaryJrpcHandle
};
