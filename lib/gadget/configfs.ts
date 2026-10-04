import nodeFs from "node:fs";
import nodePath from "node:path";

const createConfigfsDir = ({ path }: { path: string }) => {
  console.log(`creating ${path}`);
  nodeFs.mkdirSync(path, { recursive: true });
};

const writeConfigfsFile = ({ path, content }: { path: string, content: string }) => {
  console.log(`writing ${content} --> ${path}`);
  nodeFs.writeFileSync(path, content);
};

const writeConfigfsHexFile = ({ path, content }: { path: string, content: number }) => {
  const hexContent = `0x${content.toString(16)}`;
  writeConfigfsFile({ path, content: hexContent });
};

const createConfigfsLink = ({ path, target }: { path: string, target: string }) => {
  console.log(`linking ${path} --> ${target}`);
  nodeFs.symlinkSync(target, path);
};

const CONFIGFS_MAGIC = 0x62656570;

type TGadgetConfig = {
  idVendor: number;
  idProduct: number;
  bcdDevice: number;
  bcdUSB: number;
  bDeviceClass?: number;
  bDeviceSubClass?: number;
  bDeviceProtocol?: number;
  bMaxPacketSize0?: number;

  strings: {
    "0x409": {
      serialnumber: string;
      manufacturer: string;
      product: string;
    }
  },

  functions: { [key: string]: Record<string, string | number> },

  configs: {
    [key: string]: {
      functions: string[];
      strings: {
        "0x409": {
          configuration: string;
        }
      },
      bmAttributes: number;
      MaxPower: number;
    }
  }
};

type TGadgetConfigfsInstance = {
  functionPathsByNames: { [key: string]: string };

  enable: (args: { udc: string }) => void;
  disable: () => void;
}

const purgeGadgetStrings = ({ stringsDir }: { stringsDir: string }) => {
  const strings = nodeFs.readdirSync(stringsDir);

  strings.forEach((str) => {

    const strPath = nodePath.join(stringsDir, str);

    console.log(`purging strings ${strPath}`);

    nodeFs.rmdirSync(strPath);
  });
};

const purgeGadgetConfigs = ({ configsDir }: { configsDir: string }) => {
  const configs = nodeFs.readdirSync(configsDir);
  configs.forEach((config) => {

    const configPath = nodePath.join(configsDir, config);

    console.log(`purging config ${configPath}`);

    const configStringsDir = nodePath.join(configPath, "strings");
    purgeGadgetStrings({ stringsDir: configStringsDir });

    const files = nodeFs.readdirSync(configPath, { withFileTypes: true });
    const links = files.filter((file) => {
      return file.isSymbolicLink();
    });
    links.forEach((link) => {
      nodeFs.unlinkSync(nodePath.join(configPath, link.name));
    });

    nodeFs.rmdirSync(configPath);
  });
};

const purgeGadgetFunctions = ({ functionsDir }: { functionsDir: string }) => {
  const functions = nodeFs.readdirSync(functionsDir);
  functions.forEach((func) => {

    const funcPath = nodePath.join(functionsDir, func);

    console.log(`purging function ${funcPath}`);

    nodeFs.rmdirSync(funcPath);
  });
};

const purgeGadget = ({ configfsGadgetPath }: { configfsGadgetPath: string }) => {
  try {
    nodeFs.statSync(configfsGadgetPath);
  } catch (ex) {
    // @ts-expect-error types
    if (ex.code === "ENOENT") {
      return;
    }

    throw ex;
  }

  writeConfigfsFile({ path: nodePath.join(configfsGadgetPath, "UDC"), content: "" });

  const configsDir = nodePath.join(configfsGadgetPath, "configs");
  purgeGadgetConfigs({ configsDir });

  const functionsDir = nodePath.join(configfsGadgetPath, "functions");
  purgeGadgetFunctions({ functionsDir });

  const stringsDir = nodePath.join(configfsGadgetPath, "strings");
  purgeGadgetStrings({ stringsDir });

  console.log(`purging gadget ${configfsGadgetPath}`);
  nodeFs.rmdirSync(configfsGadgetPath);
};

const findConfigfsGadgetPath = ({ gadgetName }: { gadgetName: string }) => {
  const configfsRoot = "/sys/kernel/config";

  const configfsStat = nodeFs.statfsSync(configfsRoot);
  if (configfsStat.type !== CONFIGFS_MAGIC) {
    throw Error(`expected configfs at ${configfsRoot}, make sure configfs is mounted`);
  }

  const configfsGadgetRoot = `${configfsRoot}/usb_gadget`;
  try {
    nodeFs.statSync(configfsGadgetRoot);
  } catch (ex) {
    throw Error(`expected usb gadget config root at ${configfsGadgetRoot}, make sure kernel module libcomposite is loaded`, { cause: ex });
  }

  const configfsGadgetPath = `${configfsGadgetRoot}/${gadgetName}`;

  return configfsGadgetPath;
};

const createGadgetAttributesFiles = ({ configfsGadgetPath, gadgetConfig }: { configfsGadgetPath: string, gadgetConfig: TGadgetConfig }) => {
  writeConfigfsHexFile({ path: nodePath.join(configfsGadgetPath, "idVendor"), content: gadgetConfig.idVendor });
  writeConfigfsHexFile({ path: nodePath.join(configfsGadgetPath, "idProduct"), content: gadgetConfig.idProduct });
  writeConfigfsHexFile({ path: nodePath.join(configfsGadgetPath, "bcdDevice"), content: gadgetConfig.bcdDevice });
  writeConfigfsHexFile({ path: nodePath.join(configfsGadgetPath, "bcdUSB"), content: gadgetConfig.bcdUSB });
};

const createStringsFiles = ({ configfsGadgetPath, strings }: { configfsGadgetPath: string, strings: TGadgetConfig["strings"] }) => {
  const stringsDir = nodePath.join(configfsGadgetPath, "strings", "0x409");

  createConfigfsDir({ path: stringsDir });
  writeConfigfsFile({ path: nodePath.join(stringsDir, "manufacturer"), content: strings["0x409"].manufacturer });
  writeConfigfsFile({ path: nodePath.join(stringsDir, "product"), content: strings["0x409"].product });
  writeConfigfsFile({ path: nodePath.join(stringsDir, "serialnumber"), content: strings["0x409"].serialnumber });
};

const createFunctionsFiles = ({ configfsGadgetPath, functions }: { configfsGadgetPath: string, functions: TGadgetConfig["functions"] }) => {
  const functionsDir = nodePath.join(configfsGadgetPath, "functions");

  createConfigfsDir({ path: functionsDir });

  let functionPathsByNames: { [key: string]: string } = {};

  Object.keys(functions).forEach((funcName) => {
    const funcPath = nodePath.join(functionsDir, funcName);

    createConfigfsDir({ path: funcPath });

    functionPathsByNames = {
      ...functionPathsByNames,
      [funcName]: funcPath
    };

    const funcConfig = functions[funcName];
    Object.keys(funcConfig).forEach((key) => {
      const content = `${funcConfig[key]}`;
      writeConfigfsFile({ path: nodePath.join(funcPath, key), content });
    });
  });

  return { functionPathsByNames };
};

const createConfigsFiles = ({ configfsGadgetPath, configs }: { configfsGadgetPath: string, configs: TGadgetConfig["configs"] }) => {
  const configsDir = nodePath.join(configfsGadgetPath, "configs");

  createConfigfsDir({ path: configsDir });

  Object.keys(configs).forEach((configName) => {
    const configPath = nodePath.join(configsDir, configName);

    createConfigfsDir({ path: configPath });

    const config = configs[configName];

    config.functions.forEach((funcName) => {
      createConfigfsLink({ path: nodePath.join(configPath, funcName), target: nodePath.join(configfsGadgetPath, "functions", funcName) });
    });

    const stringsDir = nodePath.join(configPath, "strings", "0x409");
    createConfigfsDir({ path: stringsDir });
    writeConfigfsFile({ path: nodePath.join(stringsDir, "configuration"), content: config.strings["0x409"].configuration });

    writeConfigfsFile({ path: nodePath.join(configPath, "bmAttributes"), content: `${config.bmAttributes}` });
    writeConfigfsFile({ path: nodePath.join(configPath, "MaxPower"), content: `${config.MaxPower}` });
  });
};

const createGadgetViaConfigfs = ({
  gadgetName,
  gadgetConfig
}: {
  gadgetName: string,
  gadgetConfig: TGadgetConfig
}): TGadgetConfigfsInstance => {

  const configfsGadgetPath = findConfigfsGadgetPath({ gadgetName });
  const udcPath = nodePath.join(configfsGadgetPath, "UDC");

  purgeGadget({ configfsGadgetPath });

  nodeFs.mkdirSync(configfsGadgetPath);
  createGadgetAttributesFiles({ configfsGadgetPath, gadgetConfig });
  createStringsFiles({ configfsGadgetPath, strings: gadgetConfig.strings });
  const { functionPathsByNames } = createFunctionsFiles({ configfsGadgetPath, functions: gadgetConfig.functions });
  createConfigsFiles({ configfsGadgetPath, configs: gadgetConfig.configs });

  const enable = ({ udc }: { udc: string }) => {
    nodeFs.writeFileSync(udcPath, udc);
  };

  const disable = () => {
    const currentUdc = nodeFs.readFileSync(udcPath, "utf8");
    if (currentUdc.trim() === "") {
      return;
    }

    // we can only write an empty string if we have a UDC,
    // otherwise this would yield an error
    nodeFs.writeFileSync(udcPath, "\n");
  };

  return {
    functionPathsByNames,

    enable,
    disable
  };
};

export {
  createGadgetViaConfigfs
};
