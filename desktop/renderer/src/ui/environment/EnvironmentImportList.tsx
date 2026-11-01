// Each package has a Remove button; packages from one GitHub repository share an Update button.
import { useState } from "react"
import type { EnvironmentImport } from "../../environment/environment-api"
import { CapabilityItem } from "../hud/CapabilityItem"
import { HudButton } from "../hud/HudButton"

type EnvironmentImportListProps = {
	imported: EnvironmentImport[]
	disabled: boolean
	onRemove: (name: string) => Promise<boolean>
	onUpdate: (repository: string) => Promise<boolean>
}

function ImportRow({ item, disabled, onRemove }: { item: EnvironmentImport, disabled: boolean, onRemove: (name: string) => Promise<boolean> }) {
	const [confirming, setConfirming] = useState(false)
	const [removing, setRemoving] = useState(false)
	const remove = async () => {
		setRemoving(true)
		try {
			if (!await onRemove(item.name)) setConfirming(false)
		} finally {
			setRemoving(false)
		}
	}
	return (
		<li className="agent-hud__environment-row flex flex-col gap-2 py-2">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<span className="min-w-0 break-all">
					{item.name}
					{!item.active && <span className="agent-hud__environment-value"> Available on next start</span>}
				</span>
				<div className="flex gap-2">
					{confirming ? <>
						<HudButton variant="danger-confirm" aria-label={`Confirm removing ${item.name}`} pending={removing} disabled={disabled} onClick={() => void remove()}>Yes, remove</HudButton>
						<HudButton variant="warning" disabled={removing} onClick={() => setConfirming(false)}>Keep</HudButton>
					</> : <HudButton variant="danger" aria-label={`Remove ${item.name}`} disabled={disabled} onClick={() => setConfirming(true)}>Remove</HudButton>}
				</div>
			</div>
			<ul className="flex flex-wrap gap-3">
				{item.capabilities.map(capability => (
					<li key={capability.name}><CapabilityItem capability={capability} /></li>
				))}
			</ul>
		</li>
	)
}

function RepositoryGroup({ repository, items, disabled, onRemove, onUpdate }: {
	repository: string
	items: EnvironmentImport[]
	disabled: boolean
	onRemove: (name: string) => Promise<boolean>
	onUpdate: (repository: string) => Promise<boolean>
}) {
	const [updating, setUpdating] = useState(false)
	const commits = [...new Set(items.map(item => item.source?.commit.slice(0, 7)))]
	const update = async () => {
		setUpdating(true)
		try {
			await onUpdate(repository)
		} finally {
			setUpdating(false)
		}
	}
	return (
		<li aria-label={repository} className="flex flex-col">
			<div className="agent-hud__environment-row flex flex-wrap items-center justify-between gap-3 py-2">
				<span className="min-w-0 break-all">
					{repository}
					<span className="agent-hud__environment-value"> {commits.join(", ")}</span>
				</span>
				<HudButton aria-label={`Update ${repository}`} pending={updating} disabled={disabled} onClick={() => void update()}>
					{updating ? "Updating…" : "Update"}
				</HudButton>
			</div>
			<ul className="flex flex-col ps-4">
				{items.map(item => <ImportRow key={item.name} item={item} disabled={disabled || updating} onRemove={onRemove} />)}
			</ul>
		</li>
	)
}

export function EnvironmentImportList({ imported, disabled, onRemove, onUpdate }: EnvironmentImportListProps) {
	const repositories = [...new Set(imported.flatMap(item => item.source ? [item.source.repository] : []))]
	return (
		<section aria-label="Tools & skills" className="agent-hud__environment-imports flex flex-col gap-3 pt-4">
			<h3 className="agent-hud__capability-group-heading">Tools &amp; skills</h3>
			{imported.length === 0 ? <p className="agent-hud__environment-value">No imports yet.</p> : (
				<ul className="flex flex-col">
					{repositories.map(repository => (
						<RepositoryGroup key={repository} repository={repository} disabled={disabled} onRemove={onRemove} onUpdate={onUpdate}
							items={imported.filter(item => item.source?.repository === repository)} />
					))}
					{imported.filter(item => !item.source).map(item => <ImportRow key={item.name} item={item} disabled={disabled} onRemove={onRemove} />)}
				</ul>
			)}
		</section>
	)
}
