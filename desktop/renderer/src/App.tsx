import { useEffect, useState } from "react"
import { HudHeader } from "./components/hud/HudHeader"
import { ViewPlaceholder } from "./components/views/ViewPlaceholder"
import type { ModelId, HudView } from "./fixtures/header"

export function App() {
	const [theme, setTheme] = useState<"dark" | "light">("dark")
	const [model, setModel] = useState<ModelId>("mock")
	const [view, setView] = useState<HudView>("projects")
	const [version, setVersion] = useState<string>()
	const [failed, setFailed] = useState(false)

	useEffect(() => {
		document.documentElement.dataset.theme = theme
	}, [theme])

	useEffect(() => {
		let active = true
		const GetVersion = async () => {
			try {
				const value = await window.robozium.getVersion()
				if (value) {
					if (active) setVersion(value)
					return
				}
			} catch {
				if (active) setFailed(true)
			}
		}
		GetVersion()
		return () => {
			active = false
		}
	}, [])

	return (
		<main className="hud-frame">
			<HudHeader
				model={model} onSelectModel={setModel} view={view} onSelectView={setView}
				theme={theme}
				onToggleTheme={() =>
					setTheme((current) =>
						current === "dark" ? "light" : "dark",
					)
				}
			/>
			<div className="hud-frame__content">
				<h1>Robozium</h1>
				<p role={failed ? "alert" : "status"}>
					{failed
						? "Unable to read the application version."
						: version === undefined
							? "Loading version…"
							: `Version ${version}`}
				</p>
				<ViewPlaceholder view={view} />
			</div>
		</main>
	)
}
