import { useEffect, useState, type ReactElement, type ReactNode } from "react"

/** Read the native version once and present application-level notices. */
export function AppIdentity({ children }: { children: ReactNode }): ReactElement {
	const [version, setVersion] = useState<string>()
	const [failed, setFailed] = useState(false)

	useEffect(() => {
		let active = true
		async function loadVersion(): Promise<void> {
			try {
				const value = await window.robozium.getVersion()
				if (active && value) setVersion(value)
			} catch {
				if (active) setFailed(true)
			}
		}
		void loadVersion()
		return () => { active = false }
	}, [])

	let message = "Loading version…"
	if (failed) message = "Unable to read the application version."
	else if (version !== undefined) message = `Version ${version}`

	return (
		<div className="hud-frame__identity">
			<h1>Robozium</h1>
			<p role={failed ? "alert" : "status"}>{message}</p>
			{children}
		</div>
	)
}
