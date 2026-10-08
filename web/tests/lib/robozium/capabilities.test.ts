import { expect, it } from "vitest"
import { resolveCapabilitySelection } from "../../../lib/robozium/capabilities"
import type { CapabilityView } from "../../../lib/robozium/wire"

const catalog: CapabilityView[] = [
	{ name: "fixed", kind: "tool", selectable: false, loading: null },
	{ name: "email", kind: "skill", selectable: true, loading: "automatic" },
	{ name: "scripts", kind: "tool", selectable: true, loading: null },
	{ name: "new", kind: "tool", selectable: true, loading: null },
]

it("retains saved modes, ignores removed and fixed names, and leaves new optional capabilities off", () => {
	const saved = { email: "on_demand" as const, scripts: true, removed: true, fixed: false }
	expect(resolveCapabilitySelection(catalog, saved)).toEqual({ email: "on_demand", scripts: true })
	expect(saved).toEqual({ email: "on_demand", scripts: true, removed: true, fixed: false })
})

it("starts without optional capabilities when nothing is saved or the saved selection is empty", () => {
	expect(resolveCapabilitySelection(catalog, null)).toEqual({})
	expect(resolveCapabilitySelection(catalog, {})).toEqual({})
})

it("keeps capabilities enabled across tool/skill changes using current types and loading defaults", () => {
	expect(resolveCapabilitySelection(catalog, { email: true, scripts: "on_demand" })).toEqual({
		email: "automatic", scripts: true,
	})
})

it.each(["constructor", "toString", "__proto__"])("requires an own saved value for %s", (name) => {
	const labels: CapabilityView[] = [{ name, kind: "tool", selectable: true, loading: null }]
	expect(resolveCapabilitySelection(labels, {})).toEqual({})
	expect(resolveCapabilitySelection(labels, { [name]: true })).toEqual({ [name]: true })
})
