import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.js";
import { AuthProvider } from "./contexts/AuthContext.js";
import { PaletteProvider } from "./contexts/PaletteContext.js";
import { ThemeProvider } from "./contexts/ThemeContext.js";
import "./theme.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <PaletteProvider>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </PaletteProvider>
    </ThemeProvider>
  </React.StrictMode>
);
