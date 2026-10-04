/**
 * Narrow ambient surface for the browser globals the T010 extension glue
 * uses (no DOM lib is loaded in this workspace program).
 */

declare const location: {
  readonly origin: string;
  readonly href: string;
};

declare const chrome: {
  runtime: {
    sendMessage(message: unknown): void;
    onMessage: {
      addListener(
        listener: (message: unknown, sender: { readonly tab?: { readonly id?: number } }) => void,
      ): void;
    };
    connectNative(hostName: string): {
      postMessage(message: unknown): void;
      onMessage: {
        addListener(listener: (message: unknown) => void): void;
      };
      onDisconnect: {
        addListener(listener: () => void): void;
      };
    };
  };
  tabs: {
    get(
      tabId: number,
      callback: (tab: {
        readonly id?: number;
        readonly url?: string;
        readonly title?: string;
      }) => void,
    ): void;
  };
  scripting: {
    executeScript(details: {
      readonly target: { readonly tabId: number };
      readonly files: readonly string[];
    }): void;
  };
};
