import { createClient } from "../lib/client.ts";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { createBlockDeviceFromFilePath } from "../lib/block/blockdev-from-file.ts";

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

const serverUrl = args.u;
const blockDeviceFilepath = args.b;

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
const { numberOfPhysicalBlocks, physicalBlockSize } = blockDeviceGeometry.geometry;
console.log(`geometry: ${totalSizeHumanReadable} (${numberOfPhysicalBlocks} blocks of ${physicalBlockSize} bytes)`);

createClient({
  url: serverUrl,
  blockDevice
});
