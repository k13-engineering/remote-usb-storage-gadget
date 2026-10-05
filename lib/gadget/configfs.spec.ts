import assert from "node:assert/strict";
import { describe, it } from "mocha";

import { createGadgetViaConfigfs } from "./configfs.ts";
import { createMockSystem } from "../test-utils/mock-system.ts";

const gadgetPath = "/sys/kernel/config/usb_gadget/test";

const createGadgetConfig = ({ idVendor = 0x1234 }: { idVendor?: number } = {}) => {
  return {
    idVendor,
    idProduct: 0x5678,
    bcdDevice: 0x0100,
    bcdUSB: 0x0200,

    strings: {
      "0x409": {
        manufacturer: "Acme",
        product: "USB Gadget",
        serialnumber: "123456",
      },
    },

    functions: {
      "mass_storage.0": { stall: 0 },
    },

    configs: {
      "c.1": {
        functions: ["mass_storage.0"],
        strings: {
          "0x409": {
            configuration: "Mass Storage",
          },
        },
        bmAttributes: 0x80,
        MaxPower: 250,
      },
    },
  };
};

const expectedPaths = [
  `${gadgetPath}/UDC`,
  `${gadgetPath}/bcdDevice`,
  `${gadgetPath}/bcdUSB`,
  `${gadgetPath}/configs`,
  `${gadgetPath}/configs/c.1`,
  `${gadgetPath}/configs/c.1/MaxPower`,
  `${gadgetPath}/configs/c.1/bmAttributes`,
  `${gadgetPath}/configs/c.1/mass_storage.0`,
  `${gadgetPath}/configs/c.1/strings`,
  `${gadgetPath}/configs/c.1/strings/0x409`,
  `${gadgetPath}/configs/c.1/strings/0x409/configuration`,
  `${gadgetPath}/functions`,
  `${gadgetPath}/functions/mass_storage.0`,
  `${gadgetPath}/functions/mass_storage.0/lun.0`,
  `${gadgetPath}/functions/mass_storage.0/stall`,
  `${gadgetPath}/idProduct`,
  `${gadgetPath}/idVendor`,
  `${gadgetPath}/strings`,
  `${gadgetPath}/strings/0x409`,
  `${gadgetPath}/strings/0x409/manufacturer`,
  `${gadgetPath}/strings/0x409/product`,
  `${gadgetPath}/strings/0x409/serialnumber`,
];

describe("gadget/configfs", () => {
  it("should create the gadget in configfs", () => {
    const { system, filesystem } = createMockSystem();

    const gadget = createGadgetViaConfigfs({ gadgetName: "test", gadgetConfig: createGadgetConfig(), system });

    assert.deepStrictEqual(filesystem.paths({ under: gadgetPath }), expectedPaths);
    assert.strictEqual(filesystem.readText({ path: `${gadgetPath}/idVendor` }), "0x1234");
    assert.strictEqual(filesystem.readText({ path: `${gadgetPath}/idProduct` }), "0x5678");
    assert.strictEqual(filesystem.readText({ path: `${gadgetPath}/bcdDevice` }), "0x100");
    assert.strictEqual(filesystem.readText({ path: `${gadgetPath}/bcdUSB` }), "0x200");
    assert.strictEqual(filesystem.readText({ path: `${gadgetPath}/strings/0x409/serialnumber` }), "123456");
    assert.strictEqual(filesystem.readText({ path: `${gadgetPath}/functions/mass_storage.0/stall` }), "0");
    assert.strictEqual(filesystem.readText({ path: `${gadgetPath}/configs/c.1/strings/0x409/configuration` }), "Mass Storage");
    assert.strictEqual(filesystem.readText({ path: `${gadgetPath}/configs/c.1/bmAttributes` }), "128");
    assert.strictEqual(filesystem.readText({ path: `${gadgetPath}/configs/c.1/MaxPower` }), "250");
    const functionPath = `${gadgetPath}/functions/mass_storage.0`;
    assert.strictEqual(filesystem.symlinkTarget({ path: `${gadgetPath}/configs/c.1/mass_storage.0` }), functionPath);
    assert.deepStrictEqual(gadget.functionPathsByNames, { "mass_storage.0": `${gadgetPath}/functions/mass_storage.0` });
  });

  it("should replace an existing gadget", () => {
    const { system, filesystem } = createMockSystem();
    createGadgetViaConfigfs({ gadgetName: "test", gadgetConfig: createGadgetConfig({ idVendor: 0x1111 }), system });

    createGadgetViaConfigfs({ gadgetName: "test", gadgetConfig: createGadgetConfig({ idVendor: 0x2222 }), system });

    assert.deepStrictEqual(filesystem.paths({ under: gadgetPath }), expectedPaths);
    assert.strictEqual(filesystem.readText({ path: `${gadgetPath}/idVendor` }), "0x2222");
  });

  it("should bind the gadget to the UDC when enabled", () => {
    const { system, filesystem } = createMockSystem();
    const gadget = createGadgetViaConfigfs({ gadgetName: "test", gadgetConfig: createGadgetConfig(), system });

    gadget.enable({ udc: "fcc00000.usb" });

    assert.strictEqual(filesystem.readText({ path: `${gadgetPath}/UDC` }), "fcc00000.usb");
  });

  it("should unbind the gadget when disabled", () => {
    const { system, filesystem } = createMockSystem();
    const gadget = createGadgetViaConfigfs({ gadgetName: "test", gadgetConfig: createGadgetConfig(), system });
    gadget.enable({ udc: "fcc00000.usb" });

    gadget.disable();

    assert.strictEqual(filesystem.readText({ path: `${gadgetPath}/UDC` }), "\n");
  });

  it("should not write the UDC when disabling a gadget that is not bound", () => {
    const { system, filesystem } = createMockSystem();
    const gadget = createGadgetViaConfigfs({ gadgetName: "test", gadgetConfig: createGadgetConfig(), system });
    const writesBefore = filesystem.writes().length;

    gadget.disable();

    assert.strictEqual(filesystem.writes().length, writesBefore);
  });

  it("should fail if configfs is not mounted", () => {
    const { system } = createMockSystem({ configfsMounted: false });

    assert.throws(() => {
      createGadgetViaConfigfs({ gadgetName: "test", gadgetConfig: createGadgetConfig(), system });
    }, Error("expected configfs at /sys/kernel/config, make sure configfs is mounted"));
  });

  it("should fail if libcomposite is not loaded", () => {
    const { system, filesystem } = createMockSystem();
    filesystem.fs.rmdirSync("/sys/kernel/config/usb_gadget");

    assert.throws(() => {
      createGadgetViaConfigfs({ gadgetName: "test", gadgetConfig: createGadgetConfig(), system });
    }, (error: Error) => {
      return error.message === "expected usb gadget config root at /sys/kernel/config/usb_gadget, " +
        "make sure kernel module libcomposite is loaded";
    });
  });

  it("should pass on unexpected errors while looking for an existing gadget", () => {
    const { system } = createMockSystem();
    const accessDenied = Error("EACCES: permission denied");
    const failingSystem = {
      ...system,
      fs: {
        ...system.fs,
        statSync: ((path: string) => {
          if (path === gadgetPath) {
            throw accessDenied;
          }

          return system.fs.statSync(path);
        }) as typeof system.fs.statSync,
      },
    };

    assert.throws(() => {
      createGadgetViaConfigfs({ gadgetName: "test", gadgetConfig: createGadgetConfig(), system: failingSystem });
    }, accessDenied);
  });

  it("should log the changes to configfs", () => {
    const { system, recordingLogger } = createMockSystem();

    createGadgetViaConfigfs({ gadgetName: "test", gadgetConfig: createGadgetConfig(), system });

    assert.ok(recordingLogger.lines().includes(`log: writing 0x1234 --> ${gadgetPath}/idVendor`));
  });
});
