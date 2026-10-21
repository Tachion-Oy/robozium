import { createRoot } from "react-dom/client"
import { App } from "./app/App"
import { BackendStartup } from "./backend/BackendStartup"
import { ViewportBounds } from "./app/ViewportBounds"
import "./styles/globals.css"

const root = document.getElementById("root")
if (!root) throw new Error("The application root element is missing.")
// The reference sets this inline; the renderer CSP permits only scripted styles.
document.documentElement.style.colorScheme = document.documentElement.dataset.theme ?? "dark"
createRoot(root).render(<>
	<ViewportBounds />
	<BackendStartup>{(notice, client, connected, reconnect) => <App connectionNotice={notice} client={client} connected={connected} onReconnect={reconnect} />}</BackendStartup>
</>)
