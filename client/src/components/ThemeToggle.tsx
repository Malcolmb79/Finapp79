import { useTheme } from "../contexts/ThemeContext.js";

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <button className="theme-toggle" onClick={toggleTheme} aria-label="Toggle color theme">
      {theme === "light" ? "🌙 Dark" : "☀️ Light"}
    </button>
  );
}
