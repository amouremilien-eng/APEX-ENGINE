import { useState, useEffect } from "react";

type Theme = "classic" | "noyai";

const THEME_KEY = "cockpit_yield_theme";

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    // Lire depuis localStorage au premier render
    const saved = localStorage.getItem(THEME_KEY);
    return (saved === "noyai" ? "noyai" : "classic") as Theme;
  });

  useEffect(() => {
    // Appliquer le data-theme sur <html>
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "classic" ? "noyai" : "classic"));
  };

  return { theme, setTheme, toggleTheme };
}

interface ThemeToggleProps {
  theme: Theme;
  onToggle: () => void;
}

export function ThemeToggle({ theme, onToggle }: ThemeToggleProps) {
  return (
    <button onClick={onToggle} className="theme-toggle" title="Changer le thème">
      <span className="theme-dot" />
      {theme === "classic" ? "Classic" : "NoyAI"}
    </button>
  );
}
