import { AppView } from "./components/terminal"
import { fetchSeed } from "@/lib/robosprawl/http"
import type { ModelSelection, Project, RunView } from "@/lib/robosprawl/wire"

type HomePageProps = {
	searchParams: Promise<{ runId?: string; error?: string; from?: string }>
}

export const dynamic = "force-dynamic"

export default async function Home({ searchParams }: HomePageProps) {
	const { runId, error, from } = await searchParams
	// React streams this request to the selector's Suspense boundary while the
	// rest of the scoped run or landing data is loaded.
	const defaultModelSelectionPromise = fetchSeed<ModelSelection>("/models")
	const modelSelectionPromise = runId
		? fetchSeed<ModelSelection>(
				`/models?run_id=${encodeURIComponent(runId)}`,
			)
		: defaultModelSelectionPromise
	// Seed the run and project views together so either HUD mode paints populated
	// instead of mounting empty and flickering when its client fetch resolves.
	const initialRunViewPromise = runId
		? fetchSeed<RunView>(`/run/${encodeURIComponent(runId)}`)
		: Promise.resolve(null)
	const initialProjectsPromise = fetchSeed<Project[]>("/projects")
	const [initialRunView, initialProjects] = await Promise.all([
		initialRunViewPromise,
		initialProjectsPromise,
	])
	return (
		<AppView
			runId={runId ?? null}
			error={error ?? null}
			from={from ?? null}
			initialRunView={initialRunView}
			initialProjects={initialProjects}
			modelSelectionPromise={modelSelectionPromise}
			defaultModelSelectionPromise={defaultModelSelectionPromise}
		/>
	)
}
