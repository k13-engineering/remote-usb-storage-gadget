import { createClient } from "../lib/client.ts";
import nodeFs from "node:fs";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import type { TBlockDevice } from "../lib/client.ts";

const { argv } = yargs(hideBin(process.argv))
  .option("u", {
    alias: "server-url",
    describe: "server WebSocket URL",
    requiresArg: true,
    demandOption: true,
    type: "string",
  })
  .option("b", {
    alias: "block-device",
    describe: "path of block device to write",
    requiresArg: true,
    demandOption: true,
    type: "string",
  })
  .strict();

const args = await argv;

const blockDeviceFilepath = args.b;

const createBlockDeviceFromFilePath = async ({ filePath, blockSize }: { filePath: string, blockSize: number }): Promise<TBlockDevice> => {

  const fh = await nodeFs.promises.open(filePath, "r+");
  const stat = await fh.stat({ bigint: true });

  if (stat.size % BigInt(blockSize) !== 0n) {
    throw Error(`File size ${stat.size} is not a multiple of block size ${blockSize}`);
  }

  const read: TBlockDevice["read"] = async ({ offset, length }) => {
    throw Error("not implemented yet");
  };

  const write: TBlockDevice["write"] = async ({ offset, data }) => {
    throw Error("not implemented yet");
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

const blockDevice = await createBlockDeviceFromFilePath({
  filePath: blockDeviceFilepath,
  blockSize: 512
});

const oneGiB = 1 * 1024 * 1024 * 1024;
const oneMiB = 1 * 1024 * 1024;
const oneKiB = 1 * 1024;

const formatSizeHumanReadable = ({ bytes }: { bytes: number }) => {
  if (bytes > oneGiB) {
    return `${(bytes / oneGiB).toFixed(2)} GB`;
  } else if (bytes > oneMiB) {
    return `${(bytes / oneMiB).toFixed(2)} MB`;
  }

  return `${(bytes / oneKiB).toFixed(2)} KB`;
};

const blockDeviceGeometry = await blockDevice.queryGeometry();
const totalSize = blockDeviceGeometry.geometry.numberOfPhysicalBlocks * BigInt(blockDeviceGeometry.geometry.physicalBlockSize);
const totalSizeHumanReadable = formatSizeHumanReadable({ bytes: Number(totalSize) });

console.log(`using "${blockDeviceFilepath}" as block device`);
console.log(`geometry: ${totalSizeHumanReadable} (${blockDeviceGeometry.geometry.numberOfPhysicalBlocks} blocks of ${blockDeviceGeometry.geometry.physicalBlockSize} bytes)`)

const client = createClient({
  url: "ws://localhost:8080",
  blockDevice
});
