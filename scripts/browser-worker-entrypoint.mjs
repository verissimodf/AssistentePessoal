#!/usr/bin/env node
// Starts the worker-local loopback proxy bridge before exposing the private worker socket.
import { startProxyBridge } from "./browser-proxy-bridge.mjs";

const bridge = startProxyBridge();
bridge.once("error", () => {
  console.error("browser-worker: local proxy bridge failed to start");
  process.exit(1);
});
bridge.once("listening", async () => {
  try {
    await import("./browser-worker.mjs");
  } catch {
    console.error("browser-worker: failed to start managed worker");
    process.exit(1);
  }
});
