import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { describe, it } from "mocha";
import type { WebSocket } from "ws";

import { createClient, type TBlockDevice } from "./client.ts";
import { createWebSocketBinaryJrpc } from "./jrpc/websocket.ts";
import { createUsbGadgetServer } from "./server.ts";
import type { TStorageGadget } from "./storage-gadget.ts";
import { createFakeWebSocketPair, settle } from "./test-utils/fake-websocket.ts";
import { createRecordingLogger } from "./test-utils/recording-logger.ts";

const req = { socket: { remoteAddress: "192.0.2.1", remotePort: 51_234 } } as IncomingMessage;

// a block device in memory, which fails every operation once it is told to
const createMemoryBlockDevice = () => {
  const data = new Uint8Array(4096);
  let failing = false;

  const failIfRequested = () => {
    if (failing) {
      throw Error("disk failure");
    }
  };

  const blockDevice: TBlockDevice = {
    read: async ({ offset, length }) => {
      failIfRequested();
      return data.slice(Number(offset), Number(offset) + length);
    },

    write: async ({ offset, data: written }) => {
      failIfRequested();
      data.set(written, Number(offset));
    },

    queryGeometry: async () => {
      failIfRequested();
      return { geometry: { physicalBlockSize: 512, numberOfPhysicalBlocks: 8n } };
    },
  };

  return {
    data,
    blockDevice,
    fail: () => {
      failing = true;
    },
  };
};

// records the block devices attached to it, attach completes when the test calls finishAttach
const createFakeStorageGadget = ({ finishAttachImmediately = true }: { finishAttachImmediately?: boolean } = {}) => {
  let attachedBlockDevice: TBlockDevice | undefined = undefined;
  let detachCalls = 0;
  let finishAttach = () => {};

  const storageGadget: TStorageGadget = {
    attach: async ({ blockDevice }) => {
      attachedBlockDevice = blockDevice;

      if (!finishAttachImmediately) {
        await new Promise<void>((resolve) => {
          finishAttach = resolve;
        });
      }

      return {
        detach: async () => {
          detachCalls += 1;
          attachedBlockDevice = undefined;
        },
      };
    },

    status: () => {
      return { attached: attachedBlockDevice !== undefined };
    },
  };

  return {
    storageGadget,
    attachedBlockDevice: () => {
      if (attachedBlockDevice === undefined) {
        throw Error("no block device attached");
      }

      return attachedBlockDevice;
    },
    detachCalls: () => {
      return detachCalls;
    },
    finishAttach: () => {
      finishAttach();
    },
  };
};

const createTestSetup = ({ finishAttachImmediately = true }: { finishAttachImmediately?: boolean } = {}) => {
  const fakeStorageGadget = createFakeStorageGadget({ finishAttachImmediately });
  const serverLogger = createRecordingLogger();
  const server = createUsbGadgetServer({ storageGadget: fakeStorageGadget.storageGadget, logger: serverLogger.logger });

  const connect = () => {
    const pair = createFakeWebSocketPair();
    const memoryBlockDevice = createMemoryBlockDevice();
    createClient({ socket: pair.client.socket, blockDevice: memoryBlockDevice.blockDevice, logger: createRecordingLogger().logger });
    pair.open();
    server.serve({ socket: pair.server.socket as unknown as WebSocket, req });

    return {
      pair,
      memoryBlockDevice,
    };
  };

  return {
    fakeStorageGadget,
    serverLogger,
    server,
    connect,
  };
};

describe("server", () => {
  describe("remote block device", () => {
    it("should read from the block device of the client", async () => {
      const { fakeStorageGadget, connect } = createTestSetup();
      const { memoryBlockDevice } = connect();
      memoryBlockDevice.data.set([1, 2, 3, 4], 512);

      const data = await fakeStorageGadget.attachedBlockDevice().read({ offset: 512n, length: 4 });

      assert.deepStrictEqual(Uint8Array.from(data), Uint8Array.from([1, 2, 3, 4]));
    });

    it("should write to the block device of the client", async () => {
      const { fakeStorageGadget, connect } = createTestSetup();
      const { memoryBlockDevice } = connect();

      await fakeStorageGadget.attachedBlockDevice().write({ offset: 1024n, data: Uint8Array.from([5, 6]) });

      assert.deepStrictEqual(memoryBlockDevice.data.subarray(1024, 1026), Uint8Array.from([5, 6]));
    });

    it("should query the geometry of the block device of the client", async () => {
      const { fakeStorageGadget, connect } = createTestSetup();
      connect();

      const geometry = await fakeStorageGadget.attachedBlockDevice().queryGeometry();

      assert.deepStrictEqual(geometry, { geometry: { physicalBlockSize: 512, numberOfPhysicalBlocks: 8n } });
    });

    [
      {
        operation: "read", run: ({ blockDevice }: { blockDevice: TBlockDevice }) => {
          return blockDevice.read({ offset: 0n, length: 4 });
        } 
      },
      {
        operation: "write", run: ({ blockDevice }: { blockDevice: TBlockDevice }) => {
          return blockDevice.write({ offset: 0n, data: Uint8Array.from([1]) });
        } 
      },
      {
        operation: "queryGeometry", run: ({ blockDevice }: { blockDevice: TBlockDevice }) => {
          return blockDevice.queryGeometry();
        } 
      },
    ].forEach(({ operation, run }) => {
      it(`should throw the error the client reports for ${operation}`, async () => {
        const { fakeStorageGadget, connect } = createTestSetup();
        const { memoryBlockDevice } = connect();
        memoryBlockDevice.fail();

        await assert.rejects(run({ blockDevice: fakeStorageGadget.attachedBlockDevice() }), {
          code: -32000,
          message: `${operation} failed: disk failure`,
        });
      });

      it(`should throw for ${operation} once the connection is closed`, async () => {
        const { fakeStorageGadget, connect } = createTestSetup();
        const { pair } = connect();
        const blockDevice = fakeStorageGadget.attachedBlockDevice();
        pair.client.close();

        await settle();

        await assert.rejects(run({ blockDevice }), Error(`${operation} failed, the connection to the client is closed`));
      });
    });
  });

  it("should fail requests that are in flight when the connection closes", async () => {
    const { fakeStorageGadget, server } = createTestSetup();
    const pair = createFakeWebSocketPair();
    // a client that never answers
    createWebSocketBinaryJrpc({
      socket: pair.client.socket,
      handleRequest: async () => {
        return { error: undefined, result: undefined };
      },
      handleNotification: () => {},
      onConnectionError: () => {},
      onRemoteClose: () => {},
    });
    pair.open();
    server.serve({ socket: pair.server.socket as unknown as WebSocket, req });

    const pendingRead = fakeStorageGadget.attachedBlockDevice().read({ offset: 0n, length: 4 });
    await settle();
    pair.client.close();

    await assert.rejects(pendingRead, Error("connection closed"));
  });

  describe("connections", () => {
    it("should attach the block device of the client and detach it when the connection closes", async () => {
      const { fakeStorageGadget, serverLogger, connect } = createTestSetup();
      const { pair } = connect();
      await settle();

      assert.deepStrictEqual(fakeStorageGadget.storageGadget.status(), { attached: true });

      pair.client.close();
      await settle();

      assert.strictEqual(fakeStorageGadget.detachCalls(), 1);
      assert.deepStrictEqual(serverLogger.lines(), [
        "log: incoming connection from 192.0.2.1:51234",
        "log: Remote closed the connection",
        "log: Connection closed",
      ]);
    });

    it("should detach once attaching finishes if the connection closed before", async () => {
      const { fakeStorageGadget, connect } = createTestSetup({ finishAttachImmediately: false });
      const { pair } = connect();
      pair.client.close();
      await settle();

      assert.strictEqual(fakeStorageGadget.detachCalls(), 0);

      fakeStorageGadget.finishAttach();
      await settle();

      assert.strictEqual(fakeStorageGadget.detachCalls(), 1);
    });

    it("should reject a second client while one is attached", async () => {
      const { fakeStorageGadget, serverLogger, connect } = createTestSetup();
      connect();
      const { pair: secondPair } = connect();
      await settle();

      assert.strictEqual(secondPair.client.socket.readyState, 3);
      assert.strictEqual(fakeStorageGadget.detachCalls(), 0);
      assert.ok(serverLogger.lines().includes("log: rejecting connection, another client is already connected"));
    });

    it("should log requests, notifications and errors of the client", async () => {
      const { serverLogger, server } = createTestSetup();
      const pair = createFakeWebSocketPair();
      const clientJrpc = createWebSocketBinaryJrpc({
        socket: pair.client.socket,
        handleRequest: async () => {
          return { error: undefined, result: undefined };
        },
        handleNotification: () => {},
        onConnectionError: () => {},
        onRemoteClose: () => {},
      });
      pair.open();
      server.serve({ socket: pair.server.socket as unknown as WebSocket, req });

      clientJrpc.notify({ method: "hello", params: { version: 1 } });
      await clientJrpc.request({ method: "status", params: {}, timeoutMs: 10 });
      pair.server.failWithError({ error: Error("connection reset") });

      assert.deepStrictEqual(serverLogger.messages().slice(1), [
        { level: "log", args: ["notification", { method: "hello", params: { version: 1 } }] },
        { level: "log", args: ["request", { method: "status", params: {} }] },
        { level: "error", args: ["Connection error: WebSocket connection error"] },
        { level: "error", args: ["Error: connection reset"] },
      ]);
    });
  });
});
