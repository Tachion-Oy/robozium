// Import from GitHub: read the repository's robozium.json, choose its packages, then
// download them. A token is saved encrypted, so it asks for the settings password.
import { useState, type SubmitEvent } from "react"
import type { RepositoryImport, RepositoryPreview } from "../../environment/environment-api"
import { HudButton } from "../hud/HudButton"
import { PasswordDialog } from "../hud/PasswordDialog"

export function EnvironmentRepositoryImport({ disabled, newPassword, onPreview, onImport }: {
	disabled: boolean
	/** No secrets are saved yet, so the password is new and asked twice. */
	newPassword: boolean
	onPreview: (url: string, token: string | null) => Promise<RepositoryPreview | null>
	onImport: (request: RepositoryImport) => Promise<string | null>
}) {
	const [url, setUrl] = useState("")
	const [token, setToken] = useState("")
	const [preview, setPreview] = useState<RepositoryPreview | null>(null)
	const [chosen, setChosen] = useState<string[]>([])
	const [pending, setPending] = useState(false)
	const [asking, setAsking] = useState(false)
	const [error, setError] = useState("")

	const clear = () => {
		setPreview(null)
		setChosen([])
		setToken("")
		setUrl("")
		setError("")
	}
	const find = async (event: SubmitEvent<HTMLFormElement>) => {
		event.preventDefault()
		if (disabled || pending || !url.trim()) return
		setPending(true)
		try {
			const found = await onPreview(url.trim(), token || null)
			setPreview(found)
			setChosen(found?.packages.filter(item => !item.installed).map(item => item.path) ?? [])
			setError("")
		} finally {
			setPending(false)
		}
	}
	const download = async (password: string | null) => {
		if (!preview) return "Read the repository again."
		const failure = await onImport({ url: url.trim(), commit: preview.commit, paths: chosen, token: token || null, password })
		if (failure === null) clear()
		return failure
	}
	const start = async () => {
		if (token) {
			setAsking(true)
			return
		}
		setPending(true)
		try {
			setError(await download(null) ?? "")
		} finally {
			setPending(false)
		}
	}
	const toggle = (path: string) => setChosen(previous =>
		previous.includes(path) ? previous.filter(item => item !== path) : [...previous, path])

	return (
		<>
			<form aria-label="Import from GitHub" className="flex flex-wrap gap-3" onSubmit={event => void find(event)}>
				<input
					className="agent-hud__project-input min-w-0 flex-1"
					aria-label="GitHub repository URL"
					placeholder="https://github.com/owner/repo"
					value={url}
					disabled={disabled || pending || preview !== null}
					onChange={event => setUrl(event.target.value)}
				/>
				<input
					className="agent-hud__project-input min-w-0 flex-1"
					type="password"
					autoComplete="off"
					aria-label="GitHub token"
					placeholder="Read-only token (private repositories)"
					value={token}
					disabled={disabled || pending || preview !== null}
					onChange={event => setToken(event.target.value)}
				/>
				{preview === null && (
					<HudButton type="submit" pending={pending} disabled={disabled || !url.trim()}>
						{pending ? "Reading…" : "Find packages"}
					</HudButton>
				)}
			</form>
			{preview && (
				<section aria-label={`Packages in ${preview.repository}`} className="flex flex-col gap-3">
					<p className="agent-hud__environment-value">
						{preview.repository} at {preview.commit.slice(0, 7)}. Imported code runs as part of Robozium; add only repositories you trust.
					</p>
					<ul className="flex flex-col gap-2">
						{preview.packages.map(item => (
							<li key={item.path} className="flex flex-wrap items-center gap-3">
								<HudButton
									variant="option"
									role="checkbox"
									aria-label={item.path}
									aria-checked={chosen.includes(item.path)}
									disabled={disabled || pending || item.installed}
									onClick={() => toggle(item.path)}>
									{item.name}
								</HudButton>
								<span className="agent-hud__environment-value min-w-0 break-words">
									{item.installed ? "Already imported" : item.description}
								</span>
							</li>
						))}
					</ul>
					{error && <p role="alert">{error}</p>}
					<div className="flex flex-wrap gap-3">
						<HudButton variant="success" pending={pending} disabled={disabled || chosen.length === 0} onClick={() => void start()}>
							{pending ? "Importing…" : "Import selected"}
						</HudButton>
						<HudButton variant="warning" disabled={pending} onClick={clear}>Cancel</HudButton>
					</div>
				</section>
			)}
			<PasswordDialog open={asking} title="Save GitHub token" label="Settings password" confirm={newPassword}
				submitLabel="Import" pendingLabel="Importing…"
				onSubmit={async password => {
					const failure = await download(password)
					if (failure === null) setAsking(false)
					return failure
				}}
				onCancel={() => setAsking(false)}>
				<p>The token is saved encrypted, so Update can use it after a restart.</p>
				{newPassword && <p>This sets the password for your saved keys.</p>}
			</PasswordDialog>
		</>
	)
}
