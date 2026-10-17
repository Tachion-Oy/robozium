import { createRoot } from "react-dom/client"
import { App } from "./app/App"
import { BackendStartup } from "./backend/BackendStartup"
import "./app/app.css"

const root = document.getElementById("root")
if (!root) throw new Error("The application root element is missing.")
createRoot(root).render(<BackendStartup>{(notice, client, connected) => <App connectionNotice={notice} client={client} connected={connected} />}</BackendStartup>)
