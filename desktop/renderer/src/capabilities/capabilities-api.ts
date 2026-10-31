// Read the capability catalogue and a project's saved choices, and save new choices.
// The launch command owns request lifetimes; requests here have no local state.
import { ApiError, type DesktopApiClient } from "../api/client"

export type SkillLoading = "automatic" | "on_demand"
export type CapabilitySelection = Record<string, boolean | SkillLoading>
export interface CapabilityView {
	name: string
	kind: "tool" | "skill"
	selectable: boolean
	loading: SkillLoading | null
}

function malformed(): never {
	throw new ApiError("malformed", "The backend returned an invalid capability response.")
}

const isLoading = (value: unknown): value is SkillLoading => value === "automatic" || value === "on_demand"

export function parseCapability(value: unknown): CapabilityView {
	if (!value || typeof value !== "object" || Array.isArray(value)) malformed()
	if (!("name" in value) || typeof value.name !== "string" || !value.name.trim()) malformed()
	if (!("kind" in value) || (value.kind !== "tool" && value.kind !== "skill")) malformed()
	if (!("selectable" in value) || typeof value.selectable !== "boolean") malformed()
	const loading = "loading" in value ? value.loading : null
	if (loading !== null && !isLoading(loading)) malformed()
	return { name: value.name, kind: value.kind, selectable: value.selectable, loading }
}

function parseSelection(value: unknown): CapabilitySelection {
	if (!value || typeof value !== "object" || Array.isArray(value)) malformed()
	const entries = Object.entries(value)
	if (!entries.every(([, choice]) => typeof choice === "boolean" || isLoading(choice))) malformed()
	return Object.fromEntries(entries) as CapabilitySelection
}

const selectionPath = (project: string) => `/capabilities/${encodeURIComponent(project)}`

export async function listCapabilities(client: DesktopApiClient, signal: AbortSignal): Promise<CapabilityView[]> {
	const value = await client.request("/capabilities", { signal })
	if (!Array.isArray(value)) malformed()
	const catalog = value.map(parseCapability)
	if (new Set(catalog.map(capability => capability.name)).size !== catalog.length) malformed()
	return catalog
}

/** Null means the project has never saved a selection. */
export async function getProjectSelection(client: DesktopApiClient, project: string, signal: AbortSignal): Promise<CapabilitySelection | null> {
	const value = await client.request(selectionPath(project), { signal })
	return value === null ? null : parseSelection(value)
}

export async function saveProjectSelection(
	client: DesktopApiClient, project: string, selection: CapabilitySelection, signal: AbortSignal,
): Promise<void> {
	parseSelection(await client.request(selectionPath(project), { method: "POST", json: selection, signal }))
}
