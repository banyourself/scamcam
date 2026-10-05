import { useState } from "react";
import { Button } from "@/components/ui/button";
import { readSavedTheme, saveTheme, type Theme } from "@/lib/theme";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => readSavedTheme());
  const next: Theme = theme === "dark" ? "light" : "dark";

  return (
    <Button
      variant="outline"
      size="sm"
      aria-label={`Switch to ${next} theme`}
      onClick={() => {
        saveTheme(next);
        setTheme(next);
      }}
    >
      {next === "light" ? "Light" : "Dark"}
    </Button>
  );
}
