// Read the capability catalogue and a project's saved choices, and save new choices.
// The launch command owns request lifetimes; requests here have no local state.
import { z } from "zod"
import { nonBlank, parsePayload, type DesktopApiClient } from "../api/client"

export type SkillLoading = "automatic" | "on_demand"
export type CapabilitySelection = Record<string, boolean | SkillLoading>
export interface CapabilityView {
	name: string
	kind: "tool" | "skill"
	selectable: boolean
	loading: SkillLoading | null
}

const SkillLoading = z.enum(["automatic", "on_demand"])
const CapabilitySelection: z.ZodType<CapabilitySelection> = z.record(z.string(), z.union([z.boolean(), SkillLoading]))
export const CapabilityView: z.ZodType<CapabilityView> = z.object({
	name: nonBlank,
	kind: z.enum(["tool", "skill"]),
	selectable: z.boolean(),
	loading: SkillLoading.nullable().default(null),
})
const Catalog = z.array(CapabilityView).refine(catalog => new Set(catalog.map(capability => capability.name)).size === catalog.length)
const SavedSelection = CapabilitySelection.nullable()

const parse = <T>(schema: z.ZodType<T>, value: unknown): T =>
	parsePayload(schema, value, "The backend returned an invalid capability response.")

const selectionPath = (project: string) => `/capabilities/${encodeURIComponent(project)}`

export async function listCapabilities(client: DesktopApiClient, signal: AbortSignal): Promise<CapabilityView[]> {
	return parse(Catalog, await client.request("/capabilities", { signal }))
}

/** Null means the project has never saved a selection. */
export async function getProjectSelection(client: DesktopApiClient, project: string, signal: AbortSignal): Promise<CapabilitySelection | null> {
	return parse(SavedSelection, await client.request(selectionPath(project), { signal }))
}

export async function saveProjectSelection(
	client: DesktopApiClient, project: string, selection: CapabilitySelection, signal: AbortSignal,
): Promise<void> {
	parse(CapabilitySelection, await client.request(selectionPath(project), { method: "POST", json: selection, signal }))
}
