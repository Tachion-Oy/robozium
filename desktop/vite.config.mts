import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
	root: fileURLToPath(new URL("./renderer", import.meta.url)),
	plugins: [react()],
	build: {
		outDir: "../dist/renderer",
		emptyOutDir: true,
		// The renderer CSP allows only bundled files, not inlined data: fonts.
		assetsInlineLimit: 0,
	},
})
