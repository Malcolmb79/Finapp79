import { useTheme } from "../contexts/ThemeContext.js";

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    // The word is hidden on a phone, where the header has a scope picker, a
    // period picker, the bell and the avatar to fit as well — and it was the
    // avatar that fell off the right-hand edge. The symbol still says which
    // way the switch goes, and the label stays for a screen reader.
    <button className="theme-toggle" onClick={toggleTheme} aria-label="Toggle color theme">
      {theme === "light" ? "🌙" : "☀️"}
      <span className="theme-toggle__label">{theme === "light" ? " Dark" : " Light"}</span>
    </button>
  );
}
