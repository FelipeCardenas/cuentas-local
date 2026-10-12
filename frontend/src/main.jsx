import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Accounts from "./Accounts";
import "../../cuentas/web/style.css";
import "./style.css";
import Theme from "./Theme.jsx";
import { initialTheme, applyTheme } from "./theme";
import "./theme.css";
let storage;
try { storage = window.localStorage; } catch { /* Theme still works without persistence. */ }
applyTheme(initialTheme(storage, window.matchMedia?.("(prefers-color-scheme: dark)").matches));
createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Theme><Accounts /></Theme>
  </StrictMode>,
);
