import React from "react";
import ReactDOM from "react-dom/client";
import { HelpScreen } from "./components/HelpScreen";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <HelpScreen />
  </React.StrictMode>,
);
