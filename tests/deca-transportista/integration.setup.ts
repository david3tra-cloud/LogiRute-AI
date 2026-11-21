import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

const networkAttempts: string[] = [];
let checkedNetworkAttempts = 0;

const runTeardown = (action: () => void, errors: unknown[]) => {
  try {
    action();
  } catch (error) {
    errors.push(error);
  }
};

const installNetworkBlockers = () => {
  vi.stubGlobal("fetch", (...args: Parameters<typeof fetch>) => {
    networkAttempts.push("fetch");
    throw new Error(`Unexpected fetch request: ${String(args[0])}`);
  });
  vi.stubGlobal(
    "XMLHttpRequest",
    class {
      constructor() {
        networkAttempts.push("XMLHttpRequest");
        throw new Error("Unexpected XMLHttpRequest");
      }
    },
  );
  vi.stubGlobal(
    "WebSocket",
    class {
      constructor() {
        networkAttempts.push("WebSocket");
        throw new Error("Unexpected WebSocket");
      }
    },
  );
};

installNetworkBlockers();

beforeEach(() => {
  vi.useRealTimers();
  installNetworkBlockers();
});

afterEach(() => {
  const errors: unknown[] = [];
  runTeardown(cleanup, errors);
  runTeardown(() => window.localStorage.clear(), errors);
  runTeardown(() => window.sessionStorage.clear(), errors);
  runTeardown(() => vi.clearAllTimers(), errors);
  runTeardown(() => vi.useRealTimers(), errors);

  const unexpectedNetworkAttempts = networkAttempts.slice(
    checkedNetworkAttempts,
  );
  checkedNetworkAttempts = networkAttempts.length;
  if (unexpectedNetworkAttempts.length > 0) {
    errors.push(
      new Error(
        `Unexpected network APIs were used: ${unexpectedNetworkAttempts.join(", ")}`,
      ),
    );
  }

  runTeardown(() => vi.restoreAllMocks(), errors);
  runTeardown(() => vi.unstubAllGlobals(), errors);

  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    throw new AggregateError(errors, "Integration test teardown failed");
  }
});
