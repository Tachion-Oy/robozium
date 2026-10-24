import { useState } from "react"
import type { EnvironmentImport } from "@/lib/robozium/wire"
import { CapabilityItem } from "../CapabilityItem"
import { HudButton } from "../HudButton"

type EnvironmentImportListProps = {
	imported: EnvironmentImport[]
	disabled: boolean
	onRemove: (name: string) => Promise<boolean>
}

function ImportRow({ item, disabled, onRemove }: { item: EnvironmentImport, disabled: boolean, onRemove: (name: string) => Promise<boolean> }) {
	const [confirming, setConfirming] = useState(false)
	const remove = async () => {
		if (!await onRemove(item.name)) setConfirming(false)
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
						<HudButton variant="danger-confirm" aria-label={`Confirm removing ${item.name}`} disabled={disabled} onClick={() => void remove()}>Yes, remove</HudButton>
						<HudButton variant="warning" onClick={() => setConfirming(false)}>Keep</HudButton>
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

export function EnvironmentImportList({ imported, disabled, onRemove }: EnvironmentImportListProps) {
	return (
		<section aria-label="Tools & skills" className="agent-hud__environment-imports flex flex-col gap-3 pt-4">
			<h3 className="agent-hud__capability-group-heading">Tools &amp; skills</h3>
			{imported.length === 0 ? <p className="agent-hud__environment-value">No imports yet.</p> : (
				<ul className="flex flex-col">
					{imported.map(item => <ImportRow key={item.name} item={item} disabled={disabled} onRemove={onRemove} />)}
				</ul>
			)}
		</section>
	)
}
