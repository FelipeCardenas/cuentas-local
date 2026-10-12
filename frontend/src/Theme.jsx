import { createContext, useContext, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { applyTheme } from "./theme";

const ThemeContext = createContext("light");
export const useTheme = () => useContext(ThemeContext);

export default function Theme({ children }) {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || "light");
  const label = theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro";
  return <ThemeContext.Provider value={theme}>
    <button type="button" className="theme-toggle icon" title={label} aria-label={label}
      aria-pressed={theme === "dark"} onClick={() => {
        const next = theme === "dark" ? "light" : "dark";
        applyTheme(next);
        setTheme(next);
      }}>
      {theme === "dark" ? <Sun /> : <Moon />}
    </button>
    {children}
  </ThemeContext.Provider>;
}
