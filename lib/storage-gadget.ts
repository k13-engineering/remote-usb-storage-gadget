import type { TBlockDevice } from "./client.ts";

const createStorageGadget = () => {

  const assign = ({ blockDevice }: { blockDevice: TBlockDevice }) => {

  };

  return {
    assign
  };
};

type TStorageGadget = ReturnType<typeof createStorageGadget>;

export {
  createStorageGadget
};

export type {
  TStorageGadget
};
