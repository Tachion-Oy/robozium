// Each import names its tools and skills and has a Remove button.
import { useState } from "react"
import type { EnvironmentImport } from "../../environment/environment-api"
import { HudButton } from "../hud/HudButton"

type EnvironmentImportListProps = {
	imported: EnvironmentImport[]
	disabled: boolean
	onRemove: (name: string) => Promise<boolean>
}

const KINDS = [["Tools", "tool"], ["Skills", "skill"]] as const

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
					{item.error === null && !item.active && <span className="agent-hud__environment-value"> Available on next start</span>}
					{item.error !== null && <span className="agent-hud__environment-value"> Not loaded</span>}
				</span>
				<div className="flex gap-2">
					{confirming ? <>
						<HudButton variant="danger-confirm" aria-label={`Confirm removing ${item.name}`} pending={removing} disabled={disabled} onClick={() => void remove()}>Yes, remove</HudButton>
						<HudButton variant="warning" disabled={removing} onClick={() => setConfirming(false)}>Keep</HudButton>
					</> : <HudButton variant="danger" aria-label={`Remove ${item.name}`} disabled={disabled} onClick={() => setConfirming(true)}>Remove</HudButton>}
				</div>
			</div>
			{item.error !== null && <p className="agent-hud__environment-value break-all">{item.error}</p>}
			{KINDS.map(([label, kind]) => {
				const names = item.capabilities.filter(capability => capability.kind === kind).map(capability => capability.name.replaceAll("_", " "))
				return names.length > 0 && <p key={kind} className="break-words">{label}: {names.join(", ")}</p>
			})}
		</li>
	)
}

export function EnvironmentImportList({ imported, disabled, onRemove }: EnvironmentImportListProps) {
	if (imported.length === 0) return <p className="agent-hud__environment-value">No imports yet.</p>
	return (
		<ul className="flex flex-col">
			{imported.map(item => <ImportRow key={item.name} item={item} disabled={disabled} onRemove={onRemove} />)}
		</ul>
	)
}
