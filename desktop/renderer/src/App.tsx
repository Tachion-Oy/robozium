import { useEffect, useState } from "react"

export function App() {
	const [version, setVersion] = useState<string>()
	const [failed, setFailed] = useState(false)

	useEffect(() => {
		let active = true
		window.robozium.getVersion().then(
			value => { if (active) setVersion(value) },
			() => { if (active) setFailed(true) },
		)
		return () => { active = false }
	}, [])

	return (
		<main>
			<h1>Robozium</h1>
			<p role={failed ? "alert" : "status"}>
				{failed ? "Unable to read the application version."
					: version === undefined ? "Loading version…" : `Version ${version}`}
			</p>
		</main>
	)
}
