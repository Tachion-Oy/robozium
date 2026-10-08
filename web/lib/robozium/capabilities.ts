import type { CapabilitySelection, CapabilityView } from "./wire"

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
