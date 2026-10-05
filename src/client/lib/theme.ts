export type Theme = "dark" | "light";

const storageKey = "scamcam-theme";

export function readSavedTheme(): Theme {
  try {
    const saved = window.localStorage.getItem(storageKey);
    if (saved === "dark" || saved === "light") {
      return saved;
    }
  } catch {
    return "dark";
  }
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
}

export function saveTheme(theme: Theme): void {
  applyTheme(theme);
  try {
    window.localStorage.setItem(storageKey, theme);
  } catch {
    return;
  }
}
