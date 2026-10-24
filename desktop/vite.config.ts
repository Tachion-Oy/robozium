import path from "node:path"
import tailwindcss from "@tailwindcss/postcss"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
	root: path.join(import.meta.dirname, "renderer"),
	plugins: [react()],
	css: { postcss: { plugins: [tailwindcss()] } },
	build: {
		outDir: "../dist/renderer",
		// The application and the startup screen that main shows over it.
		rollupOptions: { input: ["index.html", "startup.html"].map(page => path.join(import.meta.dirname, "renderer", page)) },
		emptyOutDir: true,
		// The renderer CSP allows only bundled files, not inlined data: fonts.
		assetsInlineLimit: 0,
	},
})
