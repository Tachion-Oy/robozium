import { useEffect, useState } from "react"

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
			<div className="hud-frame__toolbar">
				<button
					type="button"
					className="theme-toggle"
					aria-label="Toggle color theme"
					onClick={() => setTheme(current => current === "dark" ? "light" : "dark")}>
					<span className="theme-toggle__indicator" aria-hidden="true" />
					{theme === "dark" ? "Light" : "Dark"}
				</button>
			</div>
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
