import React from "react";
import ReactDOM from "react-dom/client";
import Home from "../app/page";
import "../app/globals.css";

// vinext also evaluates Pages entries while resolving its server fallback.
// Mount only in the browser so the worker runtime never touches `document`.
if (typeof document !== "undefined") {
  const root = document.getElementById("root");
  if (root) {
    ReactDOM.createRoot(root).render(
      <React.StrictMode><Home /></React.StrictMode>,
    );
  }
}
