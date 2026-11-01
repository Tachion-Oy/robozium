// Read the capability catalogue and a project's saved choices, and save new choices.
// The launch command owns request lifetimes; requests here have no local state.
import { z } from "zod"
import { parsePayload, type DesktopApiClient } from "../api/client"

const SkillLoading = z.enum(["automatic", "on_demand"])
export type SkillLoading = z.infer<typeof SkillLoading>
const CapabilitySelection = z.record(z.string(), z.union([z.boolean(), SkillLoading]))
export type CapabilitySelection = z.infer<typeof CapabilitySelection>
export const CapabilityView = z.object({
	name: z.string().refine(name => name.trim() !== ""),
	kind: z.enum(["tool", "skill"]),
	selectable: z.boolean(),
	loading: SkillLoading.nullable().default(null),
})
export type CapabilityView = z.infer<typeof CapabilityView>
const Catalog = z.array(CapabilityView).refine(catalog => new Set(catalog.map(capability => capability.name)).size === catalog.length)

const parse = <T>(schema: z.ZodType<T>, value: unknown): T =>
	parsePayload(schema, value, "The backend returned an invalid capability response.")

const selectionPath = (project: string) => `/capabilities/${encodeURIComponent(project)}`

export async function listCapabilities(client: DesktopApiClient, signal: AbortSignal): Promise<CapabilityView[]> {
	return parse(Catalog, await client.request("/capabilities", { signal }))
}

/** Null means the project has never saved a selection. */
export async function getProjectSelection(client: DesktopApiClient, project: string, signal: AbortSignal): Promise<CapabilitySelection | null> {
	return parse(CapabilitySelection.nullable(), await client.request(selectionPath(project), { signal }))
}

export async function saveProjectSelection(
	client: DesktopApiClient, project: string, selection: CapabilitySelection, signal: AbortSignal,
): Promise<void> {
	parse(CapabilitySelection, await client.request(selectionPath(project), { method: "POST", json: selection, signal }))
}
