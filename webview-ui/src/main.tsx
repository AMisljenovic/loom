import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/components.css";
import "./styles/tokens.css";

createRoot(document.getElementById("root")!).render(<App />);
