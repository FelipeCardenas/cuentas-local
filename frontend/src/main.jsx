import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Accounts from "./Accounts";
import "../../cuentas/web/style.css";
import "./style.css";
createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Accounts />
  </StrictMode>,
);
