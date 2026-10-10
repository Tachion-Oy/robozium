"use client"

import { useEffect, useRef, useState } from "react"
import { getEnvironment, saveEnvironment, type EnvironmentEntry, type EnvironmentView } from "@/lib/robozium/environment"
import { getCredentialStatus, unlockApiKeys } from "@/lib/robozium/client"

const startupNames = new Set(["ROBOZIUM_LOCAL_DIRS", "ROBOZIUM_HUB_ROOT", "ROBOZIUM_WEB_PORT", "ROBOZIUM_API_USER", "COMPOSE_PROJECT_NAME"])
const inputClass = "min-w-0 rounded border border-current/30 bg-transparent px-2 py-1 disabled:opacity-50"
const buttonClass = "rounded border border-current/30 px-3 py-1 disabled:opacity-40"

export function EnvironmentPanel() {
	const [view, setView] = useState<EnvironmentView | null>(null)
	const [entries, setEntries] = useState<EnvironmentEntry[]>([])
	const [dirty, setDirty] = useState(false)
	const [password, setPassword] = useState("")
	const [confirmation, setConfirmation] = useState("")
	const [pending, setPending] = useState(false)
	const [error, setError] = useState("")
	const [message, setMessage] = useState("")
	const mounted = useRef(true)
	const dirtyRef = useRef(false)
	const pendingRef = useRef(false)

	useEffect(() => {
		mounted.current = true
		const controller = new AbortController()
		const refresh = async () => {
			if (pendingRef.current) return
			try {
				const next = await getEnvironment(controller.signal)
				if (controller.signal.aborted) return
				setView(previous => dirtyRef.current && previous ? { ...next, revision: previous.revision } : next)
				if (!dirtyRef.current) setEntries(next.entries)
			} catch { if (!controller.signal.aborted) setError("Could not load environment settings") }
		}
		void refresh()
		const timer = window.setInterval(() => void refresh(), 2000)
		return () => { mounted.current = false; controller.abort(); window.clearInterval(timer) }
	}, [])

	const editable = Boolean(view?.editable && !pending)
	const change = (next: EnvironmentEntry[]) => {
		if (!editable) return
		dirtyRef.current = true
		setDirty(true); setEntries(next); setError(""); setMessage("")
	}
	const update = (index: number, patch: Partial<EnvironmentEntry>) => change(entries.map((row, i) => i === index ? { ...row, ...patch } : row))
	const add = (name = "", value = "", secret = false) => {
		if (name && entries.some(row => row.name === name)) return
		change([...entries, { name, value, secret, configured: false, overridden: view?.overrides.includes(name) ?? false, startup: startupNames.has(name) }])
	}
	const needsPassword = Boolean(view?.requires_password || entries.some(row => row.secret))
	const folders = entries.find(row => row.name === "ROBOZIUM_LOCAL_DIRS")
	const setFolders = (value: string) => {
		const index = entries.findIndex(row => row.name === "ROBOZIUM_LOCAL_DIRS")
		if (index < 0) add("ROBOZIUM_LOCAL_DIRS", value)
		else update(index, { value })
	}
	const submit = async () => {
		if (!view || !editable) return
		if (entries.some(row => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(row.name) || /_ENCRYPTED$/i.test(row.name))) {
			setError("Use variable base names without the reserved _ENCRYPTED suffix."); return
		}
		if (new Set(entries.map(row => row.name)).size !== entries.length) { setError("Variable names must be unique."); return }
		if (needsPassword && (!password || (!view.requires_password && password !== confirmation))) {
			setError("Enter the password and matching confirmation."); return
		}
		setPending(true); pendingRef.current = true; setError(""); setMessage("Saving configuration…")
		let unlockPassword = password
		setPassword(""); setConfirmation("")
		try {
			const applied = await saveEnvironment({ revision: view.revision, entries: entries.map(({ name, value, secret }) => ({ name, value, secret })), password: unlockPassword || null })
			if (view.restart_available && applied?.web_port && applied.web_port !== Number(window.location.port || "80")) {
				const destination = new URL(window.location.href)
				destination.port = String(applied.web_port)
				setMessage(`Restarting at ${destination.origin}. Unlock secrets after reconnecting.`)
				const deadline = Date.now() + 180000
				while (mounted.current && Date.now() < deadline) {
					await new Promise(resolve => window.setTimeout(resolve, 1000))
					try {
						await fetch(`${destination.origin}/api/health`, { mode: "no-cors", credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(2000) })
						window.location.assign(destination.href)
						return
					} catch { /* The new listener may still be starting. */ }
				}
				throw new Error(`Open ${destination.origin} when the restart finishes.`)
			}
			if (view.restart_available) {
				setMessage("Applying settings and restarting containers…")
				const deadline = Date.now() + 180000
				let next: EnvironmentView | null = null
				while (mounted.current && Date.now() < deadline) {
					await new Promise(resolve => window.setTimeout(resolve, 1000))
					try { next = await getEnvironment() } catch { continue }
					if (next.operation.startsWith("failed")) throw new Error("The launcher could not apply these settings. Check the folder paths and try again.")
					if (next.generation !== view.generation && next.operation === "applied") break
				}
				if (!mounted.current) return
				if (!next || next.generation === view.generation) throw new Error("Restart has not finished. Refresh to check its status.")
				if (unlockPassword && (await getCredentialStatus()).locked) await unlockApiKeys({ password: unlockPassword })
			}
			if (!mounted.current) return
			const next = await getEnvironment()
			setView(next); setEntries(next.entries); dirtyRef.current = false; setDirty(false)
			setMessage(view.restart_available ? "Settings applied." : "Settings saved. Restart the development server to apply them.")
			window.dispatchEvent(new Event("robozium-credentials-changed"))
		} catch (cause) {
			if (mounted.current) { setError(cause instanceof Error ? cause.message : "Could not apply settings"); setMessage("") }
		} finally {
			unlockPassword = ""
			pendingRef.current = false
			if (mounted.current) setPending(false)
		}
	}

	return <section className="agent-hud__status-view flex min-h-0 w-full flex-1 flex-col" aria-label="Environment settings">
		<div className="agent-hud__replyBox min-h-0 flex-1 overflow-auto [--hud-reply-pad-block-start:1.25rem] [--hud-reply-pad-inline:1.5rem]">
			<div className="flex w-full flex-col gap-4 overflow-auto pb-4">
				<h2 className="text-xl">Environment</h2>
				<p>Choose settings and secrets. Changes are saved to .env.encrypt and applied by restarting the app.</p>
				{view && !view.editable && !pending && <p role="status">{["pending", "applying"].includes(view.operation) ? "An environment update is in progress." : "Stop all runs and background work before editing environment settings."}</p>}
				{view?.boot_error && <p role="alert">{view.boot_error}</p>}
				{error && <p role="alert">{error}</p>}
				{message && <p role="status">{message}</p>}
				<fieldset disabled={!editable} className="flex flex-col gap-3 disabled:opacity-60">
					<label className="flex flex-col gap-1">Capability folders
						<input className={inputClass} value={folders?.value ?? ""} onChange={event => setFolders(event.target.value)} placeholder="../robozify; /path/to/another-catalogue" />
					</label>
					<p className="text-sm opacity-70">Separate folders with semicolons. Apply to discover their tools, skills, and suggested settings.</p>
					{folders?.overridden && <p>Capability folders are overridden by the manually maintained .env.</p>}
					<div className="flex flex-wrap gap-2" aria-label="Suggested variables">
						{view?.suggestions.filter(item => item.name !== "ROBOZIUM_LOCAL_DIRS").map((item, index) => <button className={buttonClass} key={`${item.source}-${item.name}-${index}`} type="button" disabled={entries.some(row => row.name === item.name)} title={`${item.source}: ${item.value || "no default value"}`} onClick={() => add(item.name, item.value, item.secret)}>{item.name}<span className="block text-xs opacity-70">{item.source}{item.value ? ` · ${item.value}` : ""}</span></button>)}
					</div>
					{view?.example_errors.map(text => <p key={text}>{text}</p>)}
					{entries.map((row, index) => row.name === "ROBOZIUM_LOCAL_DIRS" ? null : <div key={index} className="flex flex-wrap items-center gap-2">
						<input aria-label={`Variable name ${index + 1}`} className={`${inputClass} flex-1`} value={row.name} onChange={event => update(index, { name: event.target.value, startup: startupNames.has(event.target.value), secret: startupNames.has(event.target.value) ? false : row.secret })} placeholder="VARIABLE_NAME" />
						<input aria-label={`Value for ${row.name || "new variable"}`} className={`${inputClass} flex-1`} type={row.secret ? "password" : "text"} autoComplete="off" value={row.value ?? ""} onChange={event => update(index, { value: event.target.value })} placeholder={row.configured && row.value === null ? "Configured — enter a replacement" : "Value"} />
						<label className="flex items-center gap-1"><input type="checkbox" checked={row.secret} disabled={row.startup} onChange={event => update(index, { secret: event.target.checked })} />Secret</label>
						<button className={buttonClass} type="button" aria-label={`Remove ${row.name}`} onClick={() => change(entries.filter((_, i) => i !== index))}>Remove</button>
						{row.overridden && <span className="text-sm">Overridden by .env</span>}
					</div>)}
					<button className={`${buttonClass} self-start`} type="button" onClick={() => add()}>Add variable</button>
					{needsPassword && <div className="flex flex-wrap gap-2">
						<input aria-label="Encryption password" className={inputClass} type="password" autoComplete="off" placeholder="Encryption password" value={password} onChange={event => setPassword(event.target.value)} />
						{!view?.requires_password && <input aria-label="Confirm encryption password" className={inputClass} type="password" autoComplete="off" placeholder="Confirm password" value={confirmation} onChange={event => setConfirmation(event.target.value)} />}
					</div>}
					<button className={`${buttonClass} self-start`} type="button" disabled={!dirty && !view?.boot_error} onClick={() => void submit()}>{needsPassword ? "Encrypt and apply" : "Save and apply"}</button>
				</fieldset>
				{view && view.overrides.length > 0 && <p className="text-sm">Manual .env overrides: {view.overrides.join(", ")}. Edit that file directly to change those overrides.</p>}
			</div>
		</div>
	</section>
}
