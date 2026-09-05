import { redirect } from "next/navigation"

type StartPageProps = {
	searchParams: Promise<{ runId?: string; error?: string }>
}

export default async function StartPage({ searchParams }: StartPageProps) {
	const { runId, error } = await searchParams
	const query = new URLSearchParams()
	if (runId) query.set("runId", runId)
	if (error) query.set("error", error)
	redirect(query.size ? `/?${query.toString()}` : "/")
}
