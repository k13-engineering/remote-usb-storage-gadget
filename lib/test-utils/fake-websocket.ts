import type WebSocket from "isomorphic-ws";

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 3;

type TListener = (event: { data?: unknown; message?: string }) => void;

type TPeer = {
  receive: (args: { data: string | Uint8Array }) => void;
  close: () => void;
};

// one end of an in-memory connection, implements the parts of the WebSocket APIs used by this package
const createEndpoint = () => {
  let listeners: { type: string; listener: TListener }[] = [];
  let readyState = CONNECTING;
  let peer: TPeer | undefined = undefined;
  let sentMessages: (string | Uint8Array)[] = [];

  const emit = ({ type, event = {} }: { type: string; event?: { data?: unknown; message?: string } }) => {
    listeners.filter((entry) => {
      return entry.type === type;
    }).forEach(({ listener }) => {
      listener(event);
    });
  };

  const addListener = ({ type, listener }: { type: string; listener: TListener }) => {
    listeners = [...listeners, { type, listener }];
  };

  const toMessageData = ({ data }: { data: string | Uint8Array }) => {
    if (typeof data === "string") {
      return data;
    }

    // copies into an ArrayBuffer of its own, Node.js Buffers can be views of a larger shared pool
    return new Uint8Array(data).buffer;
  };

  const socket = {
    binaryType: "nodebuffer",
    bufferedAmount: 0,

    // WebSocket exposes its state as a property
    // eslint-disable-next-line fp/no-get-set, no-restricted-syntax
    get readyState () {
      return readyState;
    },

    // the WebSocket APIs take positional parameters
    // eslint-disable-next-line k13-engineering/prefer-single-object-parameters
    addEventListener: (type: string, listener: TListener) => {
      addListener({ type, listener });
    },

    // eslint-disable-next-line k13-engineering/prefer-single-object-parameters
    on: (type: string, listener: TListener) => {
      addListener({ type, listener });
    },

    send: (data: string | Uint8Array) => {
      if (readyState !== OPEN) {
        throw Error("fake WebSocket is not open");
      }

      sentMessages = [...sentMessages, data];
      const receiver = peer;
      // like a real connection, messages arrive asynchronously
      setImmediate(() => {
        receiver?.receive({ data });
      });
    },

    close: () => {
      if (readyState === CLOSED) {
        return;
      }

      readyState = CLOSED;
      emit({ type: "close" });
      peer?.close();
    },
  };

  return {
    // cast, as the fake only implements what this package uses
    socket: socket as unknown as WebSocket,

    connect: ({ remote }: { remote: TPeer }) => {
      peer = remote;
    },

    open: () => {
      readyState = OPEN;
      emit({ type: "open" });
    },

    receive: ({ data }: { data: string | Uint8Array }) => {
      if (readyState === CLOSED) {
        return;
      }

      emit({ type: "message", event: { data: toMessageData({ data }) } });
    },

    close: () => {
      socket.close();
    },

    // like ws, passes the error itself to the listeners
    failWithError: ({ error }: { error: Error }) => {
      emit({ type: "error", event: error });
    },

    sentMessages: () => {
      return sentMessages;
    },
  };
};

type TFakeWebSocketEndpoint = ReturnType<typeof createEndpoint>;

// two connected fake WebSockets, e.g. one for the client and one for the server
const createFakeWebSocketPair = () => {
  const client = createEndpoint();
  const server = createEndpoint();

  client.connect({ remote: server });
  server.connect({ remote: client });

  return {
    client,
    server,

    open: () => {
      server.open();
      client.open();
    },
  };
};

// lets pending message deliveries and promise callbacks run to completion
const settle = async () => {
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
};

export {
  createFakeWebSocketPair,
  settle,
};

export type {
  TFakeWebSocketEndpoint,
};
