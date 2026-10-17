import { createRoot } from "react-dom/client"
import { App } from "./App"
import { BackendStartup } from "./components/startup/BackendStartup"
import "./styles/app.css"

const root = document.getElementById("root")
if (!root) throw new Error("The application root element is missing.")
createRoot(root).render(<BackendStartup>{(notice, client, connected) => <App connectionNotice={notice} client={client} connected={connected} />}</BackendStartup>)
