import path from "node:path"
import { defineConfig } from "vite"
import packageJson from "./package.json" with { type: "json" }

// The main process as one file with its libraries inside: the packaged app ships no node_modules.
export default defineConfig({
	root: import.meta.dirname,
	build: {
		ssr: path.join(import.meta.dirname, "src/main.ts"),
		outDir: path.join(import.meta.dirname, path.dirname(packageJson.main)),
		// The preload, renderer and icon build into the same folder.
		emptyOutDir: false,
		minify: false,
		rollupOptions: { output: { entryFileNames: path.basename(packageJson.main), format: "es" } },
	},
	// Electron provides its own module at runtime; Node's built-ins stay external by default.
	ssr: { noExternal: true, external: ["electron"] },
})
