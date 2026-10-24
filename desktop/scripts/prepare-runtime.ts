import process from "node:process"
import * as layout from "../src/backend-layout.ts"

const runtime = layout.resolveBackendLayout(process.env.ROBOZIUM_DESKTOP_RUNTIME ?? "", process.env.ROBOZIUM_DESKTOP_HUB || undefined)
layout.prepareBackendRuntime(runtime)
process.stdout.write(runtime.composeEnvironment + "\n")
