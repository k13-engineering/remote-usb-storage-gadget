import nodePath from "node:path";
import { realSystem, type TSystem } from "../system.ts";

const createConfigfsDir = ({ system, path }: { system: TSystem, path: string }) => {
  system.logger.log(`creating ${path}`);
  system.fs.mkdirSync(path, { recursive: true });
};

const writeConfigfsFile = ({ system, path, content }: { system: TSystem, path: string, content: string }) => {
  system.logger.log(`writing ${content} --> ${path}`);
  system.fs.writeFileSync(path, content);
};

const writeConfigfsHexFile = ({ system, path, content }: { system: TSystem, path: string, content: number }) => {
  const hexContent = `0x${content.toString(16)}`;
  writeConfigfsFile({ system, path, content: hexContent });
};

const createConfigfsLink = ({ system, path, target }: { system: TSystem, path: string, target: string }) => {
  system.logger.log(`linking ${path} --> ${target}`);
  system.fs.symlinkSync(target, path);
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

const purgeGadgetStrings = ({ system, stringsDir }: { system: TSystem, stringsDir: string }) => {
  const strings = system.fs.readdirSync(stringsDir);

  strings.forEach((str) => {

    const strPath = nodePath.join(stringsDir, str);

    system.logger.log(`purging strings ${strPath}`);

    system.fs.rmdirSync(strPath);
  });
};

const purgeGadgetConfigs = ({ system, configsDir }: { system: TSystem, configsDir: string }) => {
  const configs = system.fs.readdirSync(configsDir);
  configs.forEach((config) => {

    const configPath = nodePath.join(configsDir, config);

    system.logger.log(`purging config ${configPath}`);

    const configStringsDir = nodePath.join(configPath, "strings");
    purgeGadgetStrings({ system, stringsDir: configStringsDir });

    const files = system.fs.readdirSync(configPath, { withFileTypes: true });
    const links = files.filter((file) => {
      return file.isSymbolicLink();
    });
    links.forEach((link) => {
      system.fs.unlinkSync(nodePath.join(configPath, link.name));
    });

    system.fs.rmdirSync(configPath);
  });
};

const purgeGadgetFunctions = ({ system, functionsDir }: { system: TSystem, functionsDir: string }) => {
  const functions = system.fs.readdirSync(functionsDir);
  functions.forEach((func) => {

    const funcPath = nodePath.join(functionsDir, func);

    system.logger.log(`purging function ${funcPath}`);

    system.fs.rmdirSync(funcPath);
  });
};

const purgeGadget = ({ system, configfsGadgetPath }: { system: TSystem, configfsGadgetPath: string }) => {
  try {
    system.fs.statSync(configfsGadgetPath);
  } catch (ex) {
    // @ts-expect-error types
    if (ex.code === "ENOENT") {
      return;
    }

    throw ex;
  }

  writeConfigfsFile({ system, path: nodePath.join(configfsGadgetPath, "UDC"), content: "" });

  const configsDir = nodePath.join(configfsGadgetPath, "configs");
  purgeGadgetConfigs({ system, configsDir });

  const functionsDir = nodePath.join(configfsGadgetPath, "functions");
  purgeGadgetFunctions({ system, functionsDir });

  const stringsDir = nodePath.join(configfsGadgetPath, "strings");
  purgeGadgetStrings({ system, stringsDir });

  system.logger.log(`purging gadget ${configfsGadgetPath}`);
  system.fs.rmdirSync(configfsGadgetPath);
};

const findConfigfsGadgetPath = ({ system, gadgetName }: { system: TSystem, gadgetName: string }) => {
  const configfsRoot = "/sys/kernel/config";

  const configfsStat = system.fs.statfsSync(configfsRoot);
  if (configfsStat.type !== CONFIGFS_MAGIC) {
    throw Error(`expected configfs at ${configfsRoot}, make sure configfs is mounted`);
  }

  const configfsGadgetRoot = `${configfsRoot}/usb_gadget`;
  try {
    system.fs.statSync(configfsGadgetRoot);
  } catch (ex) {
    throw Error(`expected usb gadget config root at ${configfsGadgetRoot}, make sure kernel module libcomposite is loaded`, { cause: ex });
  }

  const configfsGadgetPath = `${configfsGadgetRoot}/${gadgetName}`;

  return configfsGadgetPath;
};

const createGadgetAttributesFiles = ({
  system,
  configfsGadgetPath,
  gadgetConfig,
}: {
  system: TSystem;
  configfsGadgetPath: string;
  gadgetConfig: TGadgetConfig;
}) => {
  writeConfigfsHexFile({ system, path: nodePath.join(configfsGadgetPath, "idVendor"), content: gadgetConfig.idVendor });
  writeConfigfsHexFile({ system, path: nodePath.join(configfsGadgetPath, "idProduct"), content: gadgetConfig.idProduct });
  writeConfigfsHexFile({ system, path: nodePath.join(configfsGadgetPath, "bcdDevice"), content: gadgetConfig.bcdDevice });
  writeConfigfsHexFile({ system, path: nodePath.join(configfsGadgetPath, "bcdUSB"), content: gadgetConfig.bcdUSB });
};

const createStringsFiles = ({
  system,
  configfsGadgetPath,
  strings,
}: {
  system: TSystem;
  configfsGadgetPath: string;
  strings: TGadgetConfig["strings"];
}) => {
  const stringsDir = nodePath.join(configfsGadgetPath, "strings", "0x409");

  createConfigfsDir({ system, path: stringsDir });
  writeConfigfsFile({ system, path: nodePath.join(stringsDir, "manufacturer"), content: strings["0x409"].manufacturer });
  writeConfigfsFile({ system, path: nodePath.join(stringsDir, "product"), content: strings["0x409"].product });
  writeConfigfsFile({ system, path: nodePath.join(stringsDir, "serialnumber"), content: strings["0x409"].serialnumber });
};

const createFunctionsFiles = ({
  system,
  configfsGadgetPath,
  functions,
}: {
  system: TSystem;
  configfsGadgetPath: string;
  functions: TGadgetConfig["functions"];
}) => {
  const functionsDir = nodePath.join(configfsGadgetPath, "functions");

  createConfigfsDir({ system, path: functionsDir });

  let functionPathsByNames: { [key: string]: string } = {};

  Object.keys(functions).forEach((funcName) => {
    const funcPath = nodePath.join(functionsDir, funcName);

    createConfigfsDir({ system, path: funcPath });

    functionPathsByNames = {
      ...functionPathsByNames,
      [funcName]: funcPath
    };

    const funcConfig = functions[funcName];
    Object.keys(funcConfig).forEach((key) => {
      const content = `${funcConfig[key]}`;
      writeConfigfsFile({ system, path: nodePath.join(funcPath, key), content });
    });
  });

  return { functionPathsByNames };
};

const createConfigsFiles = ({
  system,
  configfsGadgetPath,
  configs,
}: {
  system: TSystem;
  configfsGadgetPath: string;
  configs: TGadgetConfig["configs"];
}) => {
  const configsDir = nodePath.join(configfsGadgetPath, "configs");

  createConfigfsDir({ system, path: configsDir });

  Object.keys(configs).forEach((configName) => {
    const configPath = nodePath.join(configsDir, configName);

    createConfigfsDir({ system, path: configPath });

    const config = configs[configName];

    config.functions.forEach((funcName) => {
      createConfigfsLink({
        system,
        path: nodePath.join(configPath, funcName),
        target: nodePath.join(configfsGadgetPath, "functions", funcName),
      });
    });

    const stringsDir = nodePath.join(configPath, "strings", "0x409");
    createConfigfsDir({ system, path: stringsDir });
    writeConfigfsFile({ system, path: nodePath.join(stringsDir, "configuration"), content: config.strings["0x409"].configuration });

    writeConfigfsFile({ system, path: nodePath.join(configPath, "bmAttributes"), content: `${config.bmAttributes}` });
    writeConfigfsFile({ system, path: nodePath.join(configPath, "MaxPower"), content: `${config.MaxPower}` });
  });
};

const createGadgetViaConfigfs = ({
  gadgetName,
  gadgetConfig,
  system = realSystem,
}: {
  gadgetName: string,
  gadgetConfig: TGadgetConfig,
  system?: TSystem,
}): TGadgetConfigfsInstance => {

  const configfsGadgetPath = findConfigfsGadgetPath({ system, gadgetName });
  const udcPath = nodePath.join(configfsGadgetPath, "UDC");

  purgeGadget({ system, configfsGadgetPath });

  system.fs.mkdirSync(configfsGadgetPath);
  createGadgetAttributesFiles({ system, configfsGadgetPath, gadgetConfig });
  createStringsFiles({ system, configfsGadgetPath, strings: gadgetConfig.strings });
  const { functionPathsByNames } = createFunctionsFiles({ system, configfsGadgetPath, functions: gadgetConfig.functions });
  createConfigsFiles({ system, configfsGadgetPath, configs: gadgetConfig.configs });

  const enable = ({ udc }: { udc: string }) => {
    system.fs.writeFileSync(udcPath, udc);
  };

  const disable = () => {
    const currentUdc = system.fs.readFileSync(udcPath, "utf8");
    if (currentUdc.trim() === "") {
      return;
    }

    // we can only write an empty string if we have a UDC,
    // otherwise this would yield an error
    system.fs.writeFileSync(udcPath, "\n");
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
