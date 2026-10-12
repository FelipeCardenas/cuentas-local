export const themeKey = "cuentas-theme";

export function initialTheme(storage, prefersDark = false) {
  try {
    const saved = storage?.getItem(themeKey);
    if (saved === "light" || saved === "dark") return saved;
  } catch { /* Storage can be unavailable in private/restricted browsers. */ }
  return prefersDark ? "dark" : "light";
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(themeKey, theme); } catch { /* Keep the session usable. */ }
}
