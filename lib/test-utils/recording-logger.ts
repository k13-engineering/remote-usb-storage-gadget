import type { TLogger } from "../system.ts";

// records log output instead of printing it, so tests can check it and the test output stays readable
const createRecordingLogger = () => {
  let messages: { level: "log" | "error"; args: unknown[] }[] = [];

  const logger: TLogger = {
    log: (...args: unknown[]) => {
      messages = [...messages, { level: "log", args }];
    },

    error: (...args: unknown[]) => {
      messages = [...messages, { level: "error", args }];
    },
  };

  return {
    logger,

    messages: () => {
      return messages;
    },

    lines: () => {
      return messages.map(({ level, args }) => {
        return `${level}: ${args.join(" ")}`;
      });
    },
  };
};

export {
  createRecordingLogger,
};
