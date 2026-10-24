// Copied from robozium-electron/desktop/web/startup/main.tsx at 076b2c9.
// Adapted: the stylesheets live in ui/styles.
import { createRoot } from "react-dom/client"
import { StartupScreen } from "./StartupScreen"
import "./presentation.css"
import "../styles/fonts.css"
import "../styles/desktop.css"
import "./startup.css"

const theme = new URL(location.href).searchParams.get("theme") === "light" ? "light" : "dark"
document.documentElement.dataset.theme = theme
document.documentElement.style.colorScheme = theme
createRoot(document.getElementById("root")!).render(<StartupScreen />)
