import { createRoot } from "react-dom/client"
import { App } from "./app/App"
import { BackendStartup } from "./backend/BackendStartup"
import { ViewportBounds } from "./app/ViewportBounds"
import { applyTheme } from "../theme/theme"
import "./styles/globals.css"

const root = document.getElementById("root")
if (!root) throw new Error("The application root element is missing.")
// Apply the saved theme before the first render; the window stays hidden until load.
applyTheme(window.robozium.theme)
createRoot(root).render(<>
	<ViewportBounds />
	<BackendStartup>{(notice, client, connected, reconnect) => <App connectionNotice={notice} client={client} connected={connected} onReconnect={reconnect} />}</BackendStartup>
</>)
