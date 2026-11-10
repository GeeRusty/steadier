import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { applyAppearance, readAppearance } from "./domain/appearance";

applyAppearance(document.documentElement, readAppearance());
createRoot(document.getElementById("root")!).render(<App />);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // The app remains usable online when an embedded browser blocks workers.
      window.dispatchEvent(new CustomEvent("steadier-offline-unavailable"));
    });
  });
}
