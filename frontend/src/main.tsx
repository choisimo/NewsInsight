import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Hide initial loader and mark React as ready
const hideInitialLoader = () => {
  const loader = document.getElementById('initial-loader');
  if (loader) {
    loader.classList.add('fade-out');
    // Remove from DOM after transition
    setTimeout(() => {
      loader.remove();
      document.documentElement.classList.add('react-ready');
    }, 300);
  }
};

// Render React app
const root = createRoot(document.getElementById("root")!);
root.render(<App />);

// Hide loader after first render
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    hideInitialLoader();
  });
});
