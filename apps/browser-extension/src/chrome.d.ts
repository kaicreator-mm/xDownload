/**
 * Narrow ambient surface for the browser globals the extension glue uses
 * (no DOM lib is loaded in this workspace program). Only the APIs the
 * shipped entrypoints actually touch are declared; nothing else exists.
 */

declare const location: {
  readonly origin: string;
  readonly href: string;
};

declare const chrome: {
  runtime: {
    /** This extension's own id (internal-message boundary check). */
    readonly id: string;
    getURL(path: string): string;
    sendMessage(message: unknown): void;
    onMessage: {
      addListener(
        listener: (
          message: unknown,
          sender: {
            readonly id?: string;
            readonly tab?: { readonly id?: number };
            /** Origin URL of the sending context (extension page vs page-embedded script). */
            readonly url?: string;
          },
          sendResponse: (response: unknown) => void,
        ) => boolean | void,
      ): void;
    };
    /** Last error of an async chrome API call (checked immediately). */
    readonly lastError: { readonly message?: string } | undefined;
    connectNative(hostName: string): {
      postMessage(message: unknown): void;
      disconnect(): void;
      onMessage: {
        addListener(listener: (message: unknown) => void): void;
      };
      onDisconnect: {
        addListener(listener: () => void): void;
      };
    };
  };
  tabs: {
    get(tabId: number): Promise<{
      readonly id?: number;
      readonly url?: string;
      readonly title?: string;
    }>;
    query(query: {
      readonly active: true;
      readonly currentWindow: true;
    }): Promise<readonly { readonly id?: number; readonly url?: string }[]>;
  };
  scripting: {
    executeScript(details: {
      readonly target: { readonly tabId: number };
      readonly files: readonly string[];
    }): void;
    executeScript<T>(details: {
      readonly target: { readonly tabId: number };
      readonly func: () => T;
    }): Promise<readonly { readonly result: T }[]>;
  };
  notifications: {
    create(
      notificationId: string,
      options: {
        readonly type: 'basic';
        readonly iconUrl: string;
        readonly title: string;
        readonly message: string;
      },
    ): Promise<string>;
  };
};
