import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { loadAgents } from "./lib/agents";

// (the agents are asked for now, so Pony Assistant and Integrations open with them ready)
void loadAgents();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
