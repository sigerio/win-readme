import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { lang } from "./i18n";
import "./styles.css";

document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
