import assert from "node:assert/strict";
import { describe, it } from "mocha";
import { Binary } from "bson";

import { createClient, type TBlockDevice } from "./client.ts";
import { createWebSocketBinaryJrpc } from "./jrpc/websocket.ts";
import { createFakeWebSocketPair, settle } from "./test-utils/fake-websocket.ts";
import { createRecordingLogger } from "./test-utils/recording-logger.ts";

const createFakeBlockDevice = () => {
  let calls: unknown[] = [];

  const blockDevice: TBlockDevice = {
    read: async ({ offset, length }) => {
      calls = [...calls, { method: "read", offset, length }];
      if (offset >= 1024n * 1024n) {
        throw Error("short read: expected 4 bytes, got 0");
      }

      return Uint8Array.from(Array(length).keys());
    },

    write: async ({ offset, data }) => {
      // BSON passes binary data as Node.js Buffer, only the bytes matter
      calls = [...calls, { method: "write", offset, data: Uint8Array.from(data) }];
    },

    queryGeometry: async () => {
      return { geometry: { physicalBlockSize: 512, numberOfPhysicalBlocks: 2048n } };
    },
  };

  return {
    blockDevice,
    calls: () => {
      return calls;
    },
  };
};

// connects a client to the server side of a fake connection, the server side issues the requests
const createTestClient = () => {
  const pair = createFakeWebSocketPair();
  const fakeBlockDevice = createFakeBlockDevice();
  const recordingLogger = createRecordingLogger();

  createClient({ socket: pair.client.socket, blockDevice: fakeBlockDevice.blockDevice, logger: recordingLogger.logger });

  const server = createWebSocketBinaryJrpc({
    socket: pair.server.socket,
    handleRequest: async () => {
      throw Error("unexpected request");
    },
    handleNotification: () => {
      throw Error("unexpected notification");
    },
    onConnectionError: () => {},
    onRemoteClose: () => {},
  });

  pair.open();

  return {
    pair,
    server,
    fakeBlockDevice,
    recordingLogger,
  };
};

describe("client", () => {
  it("should read from the block device", async () => {
    const { server, fakeBlockDevice } = createTestClient();

    const { response } = await server.request({ method: "read", params: { offset: 4096n, length: 4 } });

    assert.deepStrictEqual(response, { error: undefined, result: { data: Binary.createFromBase64("AAECAw==") } });
    assert.deepStrictEqual(fakeBlockDevice.calls(), [{ method: "read", offset: 4096n, length: 4 }]);
  });

  it("should write to the block device", async () => {
    const { server, fakeBlockDevice } = createTestClient();

    const { response } = await server.request({ method: "write", params: { offset: 512n, data: Uint8Array.from([7, 8]) } });

    assert.deepStrictEqual(response, { error: undefined, result: {} });
    assert.deepStrictEqual(fakeBlockDevice.calls(), [{ method: "write", offset: 512n, data: Uint8Array.from([7, 8]) }]);
  });

  it("should report the geometry of the block device", async () => {
    const { server } = createTestClient();

    const { response } = await server.request({ method: "queryGeometry", params: {} });

    assert.deepStrictEqual(response, {
      error: undefined,
      result: { geometry: { physicalBlockSize: 512, numberOfPhysicalBlocks: 2048 } },
    });
  });

  it("should report block device errors to the server", async () => {
    const { server, recordingLogger } = createTestClient();

    const { error, response } = await server.request({ method: "read", params: { offset: 2n * 1024n * 1024n, length: 4 } });

    assert.strictEqual(error, undefined);
    assert.deepStrictEqual(response, {
      error: { code: -32000, message: "read failed: short read: expected 4 bytes, got 0", data: undefined },
      result: undefined,
    });
    assert.deepStrictEqual(recordingLogger.lines(), [
      "log: Connected",
      "error: read request failed Error: short read: expected 4 bytes, got 0",
    ]);
  });

  ["format", "toString"].forEach((method) => {
    it(`should report the unknown method ${method} to the server`, async () => {
      const { server } = createTestClient();

      const { response } = await server.request({ method, params: {} });

      assert.deepStrictEqual(response, {
        error: { code: -32601, message: `Unknown method: ${method}`, data: undefined },
        result: undefined,
      });
    });
  });

  it("should ignore notifications", async () => {
    const { server, recordingLogger } = createTestClient();

    server.notify({ method: "info", params: {} });
    await settle();

    assert.deepStrictEqual(recordingLogger.lines(), ["log: Connected"]);
  });

  it("should log when the connection closes", async () => {
    const { pair, recordingLogger } = createTestClient();

    pair.server.close();
    await settle();

    assert.deepStrictEqual(recordingLogger.lines(), ["log: Connected", "log: Remote closed the connection", "log: Connection closed"]);
  });

  it("should log connection errors", async () => {
    const { pair, recordingLogger } = createTestClient();

    pair.client.failWithError({ error: Error("connection refused") });
    await settle();

    assert.deepStrictEqual(recordingLogger.lines(), [
      "log: Connected",
      "error: Connection error: WebSocket connection error",
      "error: Error: connection refused",
    ]);
  });
});
