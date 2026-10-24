import { createRoot } from "react-dom/client"
import { StartupScreen } from "./StartupScreen"
import "./presentation.css"
import "../app/styles/fonts.css"
import "../app/components/desktop/desktop.css"
import "./startup.css"

const theme = new URL(location.href).searchParams.get("theme") === "light" ? "light" : "dark"
document.documentElement.dataset.theme = theme
document.documentElement.style.colorScheme = theme
createRoot(document.getElementById("root")!).render(<StartupScreen />)
