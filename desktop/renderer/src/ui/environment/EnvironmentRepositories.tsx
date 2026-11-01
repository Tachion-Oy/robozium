// GitHub repositories whose own robozium.json lists the packages they provide.
// A repository is its URL plus, when private, a deploy key encrypted with the
// settings password. Update fetches what the repository lists now.
import { useState, type SubmitEvent } from "react"
import type { EnvironmentRepository } from "../../environment/environment-api"
import { CapabilityItem } from "../hud/CapabilityItem"
import { HudButton } from "../hud/HudButton"
import { PasswordDialog } from "../hud/PasswordDialog"

type Actions = {
	disabled: boolean
	onUpdate: (name: string) => Promise<boolean>
	onRemove: (name: string) => Promise<boolean>
}

function RepositoryRow({ repository, disabled, onUpdate, onRemove }: Actions & { repository: EnvironmentRepository }) {
	const [confirming, setConfirming] = useState(false)
	const [pending, setPending] = useState<"update" | "remove" | null>(null)
	const act = async (kind: "update" | "remove") => {
		setPending(kind)
		try {
			await (kind === "update" ? onUpdate : onRemove)(repository.name)
		} finally {
			setPending(null)
			setConfirming(false)
		}
	}
	return (
		<li className="agent-hud__environment-row flex flex-col gap-2 py-2">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<span className="min-w-0 break-all">
					{repository.name}
					<span className="agent-hud__environment-value"> {repository.url || "No saved URL"}{repository.private && " · deploy key ••••••"}</span>
				</span>
				<div className="flex gap-2">
					{confirming ? <>
						<HudButton variant="danger-confirm" aria-label={`Confirm removing ${repository.name}`} pending={pending === "remove"} disabled={disabled}
							onClick={() => void act("remove")}>Yes, remove</HudButton>
						<HudButton variant="warning" disabled={pending !== null} onClick={() => setConfirming(false)}>Keep</HudButton>
					</> : <>
						<HudButton aria-label={`Update ${repository.name}`} pending={pending === "update"} disabled={disabled || !repository.url}
							onClick={() => void act("update")}>Update</HudButton>
						<HudButton variant="danger" aria-label={`Remove ${repository.name}`} disabled={disabled || pending !== null}
							onClick={() => setConfirming(true)}>Remove</HudButton>
					</>}
				</div>
			</div>
			<ul className="flex flex-wrap gap-3">
				{repository.packages.flatMap(item => item.capabilities.map(capability => (
					<li key={capability.name}><CapabilityItem capability={capability} /></li>
				)))}
				{repository.packages.some(item => !item.active) && <li className="agent-hud__environment-value">Available on next start</li>}
			</ul>
		</li>
	)
}

export function EnvironmentRepositories({ repositories, disabled, confirmPassword, onAdd, onUpdate, onRemove }: Actions & {
	repositories: EnvironmentRepository[]
	/** No secrets are saved yet, so the password is new: ask for it twice. */
	confirmPassword: boolean
	onAdd: (url: string, deployKey: string, password: string) => Promise<boolean>
}) {
	const [url, setUrl] = useState("")
	const [deployKey, setDeployKey] = useState("")
	const [pending, setPending] = useState(false)
	const [asking, setAsking] = useState(false)
	const add = async (password: string) => {
		setPending(true)
		try {
			if (!await onAdd(url.trim(), deployKey.trim(), password)) return "The repository was not added."
			setUrl("")
			setDeployKey("")
			setAsking(false)
			return null
		} finally {
			setPending(false)
		}
	}
	const submit = (event: SubmitEvent<HTMLFormElement>) => {
		event.preventDefault()
		if (disabled || pending || !url.trim()) return
		if (deployKey.trim()) setAsking(true)
		else void add("")
	}
	return (
		<section aria-label="Repositories" className="flex flex-col gap-3">
			<h3 className="agent-hud__capability-group-heading">Repositories</h3>
			<form aria-label="Add repository" className="flex flex-wrap gap-3" onSubmit={submit}>
				<input className="agent-hud__project-input min-w-0 flex-1" aria-label="GitHub repository URL" placeholder="https://github.com/owner/repo"
					value={url} disabled={disabled || pending} onChange={event => setUrl(event.target.value)} />
				<input className="agent-hud__project-input min-w-0 flex-1" type="password" autoComplete="off" aria-label="Deploy key"
					placeholder="Deploy key (private repositories)" value={deployKey} disabled={disabled || pending}
					onChange={event => setDeployKey(event.target.value)} />
				<HudButton type="submit" pending={pending && !asking} disabled={disabled || !url.trim()}>{pending && !asking ? "Adding…" : "Add"}</HudButton>
			</form>
			<p className="agent-hud__environment-value">Every package the repository lists in robozium.json is imported and runs as part of Robozium.</p>
			{repositories.length > 0 && (
				<ul className="flex flex-col">
					{repositories.map(repository => (
						<RepositoryRow key={repository.name} repository={repository} disabled={disabled} onUpdate={onUpdate} onRemove={onRemove} />
					))}
				</ul>
			)}
			<PasswordDialog open={asking} title="Save deploy key" label="Encryption password" confirm={confirmPassword}
				submitLabel="Add repository" pendingLabel="Adding…" onSubmit={add} onCancel={() => setAsking(false)}>
				<p>{confirmPassword ? "Choose a password to encrypt the deploy key." : "Enter the password your secrets are encrypted with."}</p>
			</PasswordDialog>
		</section>
	)
}
