import path from "node:path"
import tailwindcss from "@tailwindcss/postcss"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import packageJson from "./package.json" with { type: "json" }
import { locations } from "./src/backend-layout.ts"

export default defineConfig({
	root: path.join(import.meta.dirname, "renderer"),
	plugins: [react()],
	css: { postcss: { plugins: [tailwindcss()] } },
	build: {
		// Beside the compiled main process, which serves this folder to the window.
		outDir: path.join(import.meta.dirname, path.dirname(packageJson.main), locations.renderer),
		emptyOutDir: true,
		// The renderer CSP allows only bundled files, not inlined data: fonts.
		assetsInlineLimit: 0,
	},
})
