import assert from "node:assert/strict";
import { describe, it } from "mocha";

import type { TBlockDevice } from "./client.ts";
import { createStorageGadget } from "./storage-gadget.ts";
import { createMockSystem } from "./test-utils/mock-system.ts";

const gadgetPath = "/sys/kernel/config/usb_gadget/mygadget";

const blockDevice: TBlockDevice = {
  read: async ({ length }) => {
    return new Uint8Array(length);
  },
  write: async () => {},
  queryGeometry: async () => {
    return { geometry: { physicalBlockSize: 512, numberOfPhysicalBlocks: 8n } };
  },
};

const createTestStorageGadget = async ({ mockSystem = createMockSystem() }: { mockSystem?: ReturnType<typeof createMockSystem> } = {}) => {
  const storageGadget = await createStorageGadget({
    udc: "fcc00000.usb",

    idVendor: 0x27df,
    idProduct: 0x16c0,
    bcdDevice: 0x0100,

    manufacturer: "k13 engineering GmbH",
    product: "Remote USB Storage Gadget",
    serialnumber: "0001",

    system: mockSystem.system,
  });

  return {
    ...mockSystem,
    storageGadget,
  };
};

describe("storage-gadget", () => {
  it("should create a disabled mass storage gadget", async () => {
    const { storageGadget, filesystem } = await createTestStorageGadget();

    assert.strictEqual(filesystem.readText({ path: `${gadgetPath}/idVendor` }), "0x27df");
    assert.strictEqual(filesystem.readText({ path: `${gadgetPath}/strings/0x409/manufacturer` }), "k13 engineering GmbH");
    assert.strictEqual(filesystem.readText({ path: `${gadgetPath}/UDC` }), "\n");
    assert.deepStrictEqual(storageGadget.status(), { attached: false });
  });

  it("should serve an attached block device through the virtual file", async () => {
    const { storageGadget, filesystem } = await createTestStorageGadget();

    await storageGadget.attach({ blockDevice });

    assert.deepStrictEqual(storageGadget.status(), { attached: true });
    assert.strictEqual(filesystem.statCalls(), 1);
    assert.match(filesystem.readText({ path: `${gadgetPath}/functions/mass_storage.0/lun.0/file` }), /^\/proc\/4242\/fd\/\d+$/);
    assert.strictEqual(filesystem.readText({ path: `${gadgetPath}/UDC` }), "fcc00000.usb");
  });

  it("should only attach one block device at a time", async () => {
    const { storageGadget } = await createTestStorageGadget();
    await storageGadget.attach({ blockDevice });

    await assert.rejects(storageGadget.attach({ blockDevice }), Error("already attached"));
  });

  it("should unbind the gadget when detaching", async () => {
    const { storageGadget, filesystem } = await createTestStorageGadget();
    const attachment = await storageGadget.attach({ blockDevice });

    await attachment.detach();

    assert.deepStrictEqual(storageGadget.status(), { attached: false });
    assert.strictEqual(filesystem.readText({ path: `${gadgetPath}/UDC` }), "\n");
  });

  it("should remove the block device from the virtual file when detaching", async () => {
    const { storageGadget, mockFuse } = await createTestStorageGadget();
    const attachment = await storageGadget.attach({ blockDevice });

    await attachment.detach();
    const response = await mockFuse.request({
      opcode: "READ",
      request: { nodeId: 2n, fh: 1n, offset: 0n, size: 4n, readFlags: 0n, lockOwner: 0n },
    });

    assert.deepStrictEqual(response, { forOpcode: "READ", unique: 1n, errorCode: -5, result: undefined });
  });

  it("should detach only once", async () => {
    const { storageGadget } = await createTestStorageGadget();
    const attachment = await storageGadget.attach({ blockDevice });
    await attachment.detach();

    await assert.rejects(attachment.detach(), Error("already detached"));
  });

  it("should not stay attached if attaching fails", async () => {
    const mockSystem = createMockSystem();
    const { writeFile } = mockSystem.system.fs.promises;
    let failWrites = true;
    const failingMockSystem = {
      ...mockSystem,
      system: {
        ...mockSystem.system,
        fs: {
          ...mockSystem.system.fs,
          promises: {
            ...mockSystem.system.fs.promises,
            writeFile: (async (...args: Parameters<typeof writeFile>) => {
              if (failWrites) {
                throw Error("EBUSY: resource busy");
              }

              return writeFile(...args);
            }) as typeof writeFile,
          },
        },
      },
    };
    const { storageGadget } = await createTestStorageGadget({ mockSystem: failingMockSystem });

    await assert.rejects(storageGadget.attach({ blockDevice }), Error("EBUSY: resource busy"));
    assert.deepStrictEqual(storageGadget.status(), { attached: false });

    failWrites = false;
    await storageGadget.attach({ blockDevice });
    assert.deepStrictEqual(storageGadget.status(), { attached: true });
  });

  it("should attach again after detaching", async () => {
    const { storageGadget } = await createTestStorageGadget();
    const attachment = await storageGadget.attach({ blockDevice });
    await attachment.detach();

    await storageGadget.attach({ blockDevice });

    assert.deepStrictEqual(storageGadget.status(), { attached: true });
  });
});
