// Contracts come from the desktop capability API.
import type { CapabilitySelection, CapabilityView } from "./capabilities-api"

/** A capability's state for a launch. Only a skill can be on demand: listed for the agent, which loads it when it needs it. */
export enum CapabilityState {
	Off = "off",
	OnDemand = "on_demand",
	On = "on",
}

/** Keep available optional choices; new capabilities stay off and fixed ones are implicit. */
export function resolveCapabilitySelection(
	catalog: CapabilityView[],
	selection: CapabilitySelection | null,
): CapabilitySelection {
	const choices = new Map(Object.entries(selection ?? {}))
	return Object.fromEntries(catalog.flatMap((capability) => {
		const choice = choices.get(capability.name)
		if (!capability.selectable || !choice) return []
		const value = capability.kind === "tool"
			? true
			: typeof choice === "string" ? choice : capability.loading ?? true
		return [[capability.name, value]]
	}))
}
