import process from "node:process"
import layout from "../src/backend-layout.cjs"

const runtime = layout.resolveBackendLayout(process.env.ROBOZIUM_DESKTOP_RUNTIME ?? "", process.env.ROBOZIUM_DESKTOP_HUB || undefined)
layout.prepareBackendRuntime(runtime)
process.stdout.write(runtime.composeEnvironment + "\n")
