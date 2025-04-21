import type WebSocket from "isomorphic-ws";
import { create as createJrpc } from "yajrpc";
import type { TJsonRpcMessage, TNotificationHandler, TRequestHandler } from "yajrpc";
import { BSON } from "bson";

const createWebSocketJrpc = ({
  socket,
  handleRequest,
  handleNotification,
}: {
  socket: WebSocket,
  handleRequest: TRequestHandler;
  handleNotification: TNotificationHandler;
}) => {

  const sendMessage = ({ message }: { message: TJsonRpcMessage }) => {
    socket.send(JSON.stringify(message));
  };

  const jrpc = createJrpc({
    sendMessage,
    handleRequest,
    handleNotification
  });

  socket.addEventListener("message", (event) => {
    jrpc.receivedMessage({ message: JSON.parse(event.data) });
  });

  socket.addEventListener("close", () => {
    jrpc.close();
  });

  return {
    request: jrpc.request,
    notify: jrpc.notify
  };
};

const createWebSocketBinaryJrpc = ({
  socket,
  handleRequest,
  handleNotification,
}: {
  socket: WebSocket,
  handleRequest: TRequestHandler;
  handleNotification: TNotificationHandler;
}) => {

  const sendMessage = ({ message }: { message: TJsonRpcMessage }) => {
    socket.send(BSON.serialize(message));
  };

  const jrpc = createJrpc({
    sendMessage,
    handleRequest,
    handleNotification
  });

  socket.addEventListener("message", (event) => {
    const message = BSON.deserialize(event.data);
    jrpc.receivedMessage({ message });
  });

  socket.addEventListener("close", () => {
    jrpc.close();
  });

  return {
    request: jrpc.request,
    notify: jrpc.notify
  };
};

type TWebsocketBinaryJrpcHandle = ReturnType<typeof createWebSocketBinaryJrpc>;

type TWebsocketJrpcHandle = ReturnType<typeof createWebSocketJrpc>;

export {
  createWebSocketJrpc,
  createWebSocketBinaryJrpc
};

export type {
  TWebsocketJrpcHandle,
  TWebsocketBinaryJrpcHandle
};
