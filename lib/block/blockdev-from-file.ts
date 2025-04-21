import nodeFs from "node:fs";
import type { TBlockDevice } from "../client.ts";

const createBlockDeviceFromFilePath = async ({ filePath, blockSize }: { filePath: string, blockSize: number }): Promise<TBlockDevice> => {

  const fh = await nodeFs.promises.open(filePath, "r+");
  const stat = await fh.stat({ bigint: true });

  if (stat.size % BigInt(blockSize) !== 0n) {
    throw Error(`File size ${stat.size} is not a multiple of block size ${blockSize}`);
  }

  const read: TBlockDevice["read"] = async ({ offset, length }) => {

    const buffer = new Uint8Array(length);

    const { bytesRead } = await fh.read(buffer, 0, length, Number(offset));

    if (bytesRead !== length) {
      throw Error(`short read: expected ${length} bytes, got ${bytesRead}`);
    }

    return buffer;
  };

  const write: TBlockDevice["write"] = async ({ offset, data }) => {
    const { bytesWritten } = await fh.write(data, 0, data.length, Number(offset));
    if (bytesWritten !== data.length) {
      throw Error(`short write: expected ${data.length} bytes, got ${bytesWritten}`);
    }
  };

  const queryGeometry: TBlockDevice["queryGeometry"] = async () => {
    return {
      geometry: {
        physicalBlockSize: blockSize,
        numberOfPhysicalBlocks: stat.size / BigInt(blockSize)
      }
    };
  };

  return {
    read,
    write,
    queryGeometry
  };
};

export {
  createBlockDeviceFromFilePath
};
