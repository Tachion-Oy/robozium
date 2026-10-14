import { useEffect, useState } from "react"
import { HudHeader } from "./HudHeader"

export function App() {
	const [theme, setTheme] = useState<"dark" | "light">("dark")
	const [version, setVersion] = useState<string>()
	const [failed, setFailed] = useState(false)

	useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])

	useEffect(() => {
		let active = true
		window.robozium.getVersion().then(
			value => { if (active) setVersion(value) },
			() => { if (active) setFailed(true) },
		)
		return () => { active = false }
	}, [])

	return (
		<main className="hud-frame">
			<HudHeader theme={theme}
				onToggleTheme={() => setTheme(current => current === "dark" ? "light" : "dark")} />
			<div className="hud-frame__content">
				<h1>Robozium</h1>
				<p role={failed ? "alert" : "status"}>
					{failed ? "Unable to read the application version."
						: version === undefined ? "Loading version…" : `Version ${version}`}
				</p>
			</div>
		</main>
	)
}
