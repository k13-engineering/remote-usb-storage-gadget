import assert from "node:assert/strict";
import { describe, it } from "mocha";
import { Binary } from "bson";

import { createWebSocketBinaryJrpc } from "./websocket.ts";
import {
  createFakeWebSocketPair,
  settle,
  type TFakeWebSocketEndpoint
} from "../test-utils/fake-websocket.ts";

type TJrpcOptions = Parameters<typeof createWebSocketBinaryJrpc>[0];

const unexpected = () => {
  throw Error("unexpected call");
};

const createEndpointJrpc = ({
  endpoint,
  handleRequest = async () => {
    return unexpected();
  },
  handleNotification = unexpected,
}: {
  endpoint: TFakeWebSocketEndpoint;
  handleRequest?: TJrpcOptions["handleRequest"];
  handleNotification?: TJrpcOptions["handleNotification"];
}) => {
  let connectionErrors: Error[] = [];
  let remoteCloses = 0;

  const jrpc = createWebSocketBinaryJrpc({
    socket: endpoint.socket,
    handleRequest,
    handleNotification,
    onConnectionError: ({ error }) => {
      connectionErrors = [...connectionErrors, error];
    },
    onRemoteClose: () => {
      remoteCloses += 1;
    },
  });

  return {
    jrpc,
    connectionErrors: () => {
      return connectionErrors;
    },
    remoteCloses: () => {
      return remoteCloses;
    },
  };
};

describe("jrpc/websocket", () => {
  it("should exchange requests and responses as BSON", async () => {
    const pair = createFakeWebSocketPair();
    const server = createEndpointJrpc({ endpoint: pair.server });
    createEndpointJrpc({
      endpoint: pair.client,
      handleRequest: async ({ method, params }) => {
        return { error: undefined, result: { method, params } };
      },
    });
    pair.open();

    const { error, response } = await server.jrpc.request({
      method: "echo",
      params: { offset: 4096n, data: Uint8Array.from([1, 2, 3]) },
    });

    assert.strictEqual(error, undefined);
    assert.deepStrictEqual(response, {
      error: undefined,
      result: {
        method: "echo",
        params: { offset: 4096, data: Binary.createFromBase64("AQID") },
      },
    });
    assert.ok(pair.server.sentMessages()[0] instanceof Uint8Array);
  });

  it("should deliver notifications", async () => {
    const pair = createFakeWebSocketPair();
    const server = createEndpointJrpc({ endpoint: pair.server });
    let notifications: unknown[] = [];
    createEndpointJrpc({
      endpoint: pair.client,
      handleNotification: ({ method, params }) => {
        notifications = [...notifications, { method, params }];
      },
    });
    pair.open();

    server.jrpc.notify({ method: "error", params: { message: "busy" } });
    await settle();

    assert.deepStrictEqual(notifications, [{ method: "error", params: { message: "busy" } }]);
  });

  it("should close the connection on text messages", async () => {
    const pair = createFakeWebSocketPair();
    const client = createEndpointJrpc({ endpoint: pair.client });
    pair.open();

    pair.client.receive({ data: "{}" });
    await settle();

    assert.strictEqual(client.connectionErrors().length, 1);
    assert.strictEqual((client.connectionErrors()[0].cause as Error).message, "unsupported WebSocket data type");
    assert.strictEqual(pair.client.socket.readyState, 3);
  });

  it("should close the connection on messages that are not BSON", async () => {
    const pair = createFakeWebSocketPair();
    const client = createEndpointJrpc({ endpoint: pair.client });
    pair.open();

    pair.client.receive({ data: Uint8Array.from([1, 2, 3]) });
    await settle();

    assert.strictEqual(client.connectionErrors().length, 1);
    assert.strictEqual(client.connectionErrors()[0].message, "failed to parse WebSocket message");
  });

  it("should report when the remote closes the connection", async () => {
    const pair = createFakeWebSocketPair();
    const client = createEndpointJrpc({ endpoint: pair.client });
    pair.open();

    pair.server.close();
    await settle();

    assert.strictEqual(client.remoteCloses(), 1);
  });
});
