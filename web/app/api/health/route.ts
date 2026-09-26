export const dynamic = "force-dynamic"

/** Check the web process without rendering a page or requesting models. */
export function GET() {
	return Response.json({ status: "ok" })
}
