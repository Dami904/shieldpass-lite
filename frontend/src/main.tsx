// Node-global shims for browser ZK proving / wallet libs (snarkjs, smart-account-kit)
// that reference Buffer/process/global without importing them.
import { Buffer } from "buffer";
import process from "process";
(globalThis as any).Buffer ||= Buffer;
(globalThis as any).process ||= process;
(globalThis as any).global ||= globalThis;

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
