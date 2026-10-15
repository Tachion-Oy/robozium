import { useEffect, useState } from "react"
import { HudHeader } from "./components/hud/HudHeader"
import { ViewPlaceholder } from "./components/views/ViewPlaceholder"
import { RunOverview } from "./components/views/RunOverview"
import { HudPanels } from "./components/hud/HudPanels"
import { HudDividerControls, type LayoutMode } from "./components/hud/HudDividerControls"
import { mockMessage } from "./fixtures/run"
import type { ModelId, HudView } from "./fixtures/header"

export function App() {
	const [theme, setTheme] = useState<"dark" | "light">("dark")
	const [model, setModel] = useState<ModelId>("mock")
	const [view, setView] = useState<HudView>("projects")
	const [hasRun, setHasRun] = useState(false)
	const [draft, setDraft] = useState("")
	const [layout, setLayout] = useState<LayoutMode>("top")
	const [focusRunEditor, setFocusRunEditor] = useState(false)
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
				model={model} onSelectModel={setModel} view={view} hasRun={hasRun}
				onSelectView={next => { setFocusRunEditor(false); setView(next) }}
				theme={theme}
				onToggleTheme={() =>
					setTheme((current) =>
						current === "dark" ? "light" : "dark",
					)
				}
			/>
			<div className="hud-frame__identity">
				<h1>Robozium</h1>
				<p role={failed ? "alert" : "status"}>
					{failed
						? "Unable to read the application version."
						: version === undefined
							? "Loading version…"
							: `Version ${version}`}
				</p>
			</div>
			<div className="hud-frame__content">
				{view === "run" ? (
					<HudPanels message={mockMessage} draft={draft} onDraftChange={setDraft}
						layout={layout} focusOnOpen={focusRunEditor} />
				) : view === "projects" ? (
					<RunOverview hasRun={hasRun} onOpen={() => {
						setHasRun(true)
						setFocusRunEditor(true)
						setView("run")
					}} />
				) : <ViewPlaceholder view={view} />}
			</div>
			<HudDividerControls mode={layout} disabled={view !== "run"} onChange={setLayout} />
		</main>
	)
}
