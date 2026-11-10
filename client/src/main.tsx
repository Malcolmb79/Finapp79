import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.js";
import { AccountScopeProvider } from "./contexts/ViewFilterContext.js";
import { AuthProvider } from "./contexts/AuthContext.js";
import { PaletteProvider } from "./contexts/PaletteContext.js";
import { RefreshProvider } from "./contexts/RefreshContext.js";
import { ThemeProvider } from "./contexts/ThemeContext.js";
import "./theme.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <PaletteProvider>
        <BrowserRouter>
          <AuthProvider>
            <AccountScopeProvider>
              <RefreshProvider>
                <App />
              </RefreshProvider>
            </AccountScopeProvider>
          </AuthProvider>
        </BrowserRouter>
      </PaletteProvider>
    </ThemeProvider>
  </React.StrictMode>
);

/**
 * Registers the service worker, which is what lets a browser offer to install
 * this and what makes it open with no signal. See public/sw.js for the rule
 * that matters: nothing under /api is ever cached.
 *
 * Production only. In dev the worker would sit in front of Vite's module
 * graph and serve yesterday's code back during a hot reload, which is a
 * confusing hour nobody needs.
 */
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    // Failure here is not worth surfacing: the app works without it, and an
    // install prompt that did not appear is not something to interrupt
    // somebody about.
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
