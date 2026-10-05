import assert from "node:assert/strict";
import { describe, it } from "mocha";

import { createBlockDeviceFromFilePath } from "./blockdev-from-file.ts";
import { createMockSystem } from "../test-utils/mock-system.ts";

const createImageFile = ({ size }: { size: number }) => {
  const mockSystem = createMockSystem();
  const content = Uint8Array.from(Array(size).keys(), (value) => {
    return value % 256;
  });
  mockSystem.filesystem.fs.writeFileSync("/tmp/disk.img", content);

  return mockSystem;
};

describe("block/blockdev-from-file", () => {
  it("should report the geometry of the file", async () => {
    const { system } = createImageFile({ size: 2048 });

    const blockDevice = await createBlockDeviceFromFilePath({ filePath: "/tmp/disk.img", blockSize: 512, system });

    assert.deepStrictEqual(await blockDevice.queryGeometry(), { geometry: { physicalBlockSize: 512, numberOfPhysicalBlocks: 4n } });
  });

  it("should read from the file", async () => {
    const { system } = createImageFile({ size: 2048 });
    const blockDevice = await createBlockDeviceFromFilePath({ filePath: "/tmp/disk.img", blockSize: 512, system });

    const data = await blockDevice.read({ offset: 512n, length: 4 });

    assert.deepStrictEqual(data, Uint8Array.from([0, 1, 2, 3]));
  });

  it("should write to the file", async () => {
    const { system, filesystem } = createImageFile({ size: 2048 });
    const blockDevice = await createBlockDeviceFromFilePath({ filePath: "/tmp/disk.img", blockSize: 512, system });

    await blockDevice.write({ offset: 1024n, data: Uint8Array.from([9, 9]) });

    assert.deepStrictEqual(filesystem.readBytes({ path: "/tmp/disk.img" }).subarray(1023, 1027), Uint8Array.from([255, 9, 9, 2]));
  });

  it("should throw on short reads", async () => {
    const { system } = createImageFile({ size: 2048 });
    const blockDevice = await createBlockDeviceFromFilePath({ filePath: "/tmp/disk.img", blockSize: 512, system });

    await assert.rejects(blockDevice.read({ offset: 2046n, length: 4 }), Error("short read: expected 4 bytes, got 2"));
  });

  it("should throw on short writes", async () => {
    const { system } = createImageFile({ size: 2048 });
    const open = system.fs.promises.open;
    const shortWritingSystem = {
      ...system,
      fs: {
        ...system.fs,
        promises: {
          ...system.fs.promises,
          open: async (...args: Parameters<typeof open>) => {
            const fileHandle = await open(...args);
            return {
              ...fileHandle,
              stat: fileHandle.stat,
              write: async () => {
                return { bytesWritten: 1, buffer: new Uint8Array(0) };
              },
            } as unknown as Awaited<ReturnType<typeof open>>;
          },
        },
      },
    };
    const blockDevice = await createBlockDeviceFromFilePath({ filePath: "/tmp/disk.img", blockSize: 512, system: shortWritingSystem });

    await assert.rejects(blockDevice.write({ offset: 0n, data: Uint8Array.from([1, 2]) }), Error("short write: expected 2 bytes, got 1"));
  });

  it("should reject files whose size is not a multiple of the block size", async () => {
    const { system } = createImageFile({ size: 1000 });

    await assert.rejects(
      createBlockDeviceFromFilePath({ filePath: "/tmp/disk.img", blockSize: 512, system }),
      Error("File size 1000 is not a multiple of block size 512")
    );
  });
});
