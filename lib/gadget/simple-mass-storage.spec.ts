import assert from "node:assert/strict";
import { describe, it } from "mocha";

import { createSimpleMassStorageGadget } from "./simple-mass-storage.ts";
import { createMockSystem } from "../test-utils/mock-system.ts";

const gadgetPath = "/sys/kernel/config/usb_gadget/storage";

const createTestGadget = () => {
  const mockSystem = createMockSystem();

  const gadget = createSimpleMassStorageGadget({
    gadgetName: "storage",
    massStorageConfig: {
      idVendor: 0x27df,
      idProduct: 0x16c0,
      bcdDevice: 0x0100,
      bcdUSB: 0x0200,
      strings: {
        "0x409": {
          manufacturer: "k13 engineering GmbH",
          product: "Remote USB Storage Gadget",
          serialnumber: "0001",
        },
      },
    },
    system: mockSystem.system,
  });

  return {
    ...mockSystem,
    gadget,
  };
};

describe("gadget/simple-mass-storage", () => {
  it("should create a gadget with a single mass storage function", () => {
    const { filesystem } = createTestGadget();

    assert.strictEqual(filesystem.readText({ path: `${gadgetPath}/idVendor` }), "0x27df");
    assert.strictEqual(filesystem.readText({ path: `${gadgetPath}/strings/0x409/product` }), "Remote USB Storage Gadget");
    const functionPath = `${gadgetPath}/functions/mass_storage.0`;
    assert.strictEqual(filesystem.symlinkTarget({ path: `${gadgetPath}/configs/c.1/mass_storage.0` }), functionPath);
    assert.strictEqual(filesystem.readText({ path: `${gadgetPath}/configs/c.1/bmAttributes` }), "128");
  });

  it("should back the logical unit with the file descriptor of this process", async () => {
    const { gadget, filesystem } = createTestGadget();

    await gadget.assignLogicalUnitByFd({ fd: 23 });

    assert.strictEqual(filesystem.readText({ path: `${gadgetPath}/functions/mass_storage.0/lun.0/file` }), "/proc/4242/fd/23");
  });

  it("should bind to and unbind from the UDC", () => {
    const { gadget, filesystem } = createTestGadget();

    gadget.enable({ udc: "fcc00000.usb" });
    assert.strictEqual(filesystem.readText({ path: `${gadgetPath}/UDC` }), "fcc00000.usb");

    gadget.disable();
    assert.strictEqual(filesystem.readText({ path: `${gadgetPath}/UDC` }), "\n");
  });
});
