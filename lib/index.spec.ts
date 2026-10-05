import assert from "node:assert/strict";
import { describe, it } from "mocha";

import * as remoteUsbStorageGadget from "./index.ts";

describe("index", () => {
  it("should export the public API", () => {
    const exportedFunctions = Object.entries(remoteUsbStorageGadget).filter(([, value]) => {
      return typeof value === "function";
    }).map(([name]) => {
      return name;
    });

    assert.deepStrictEqual(exportedFunctions.toSorted(), [
      "createBlockDeviceFromFilePath",
      "createClient",
      "createStorageGadget",
      "createUsbGadgetServer",
    ]);
  });
});
