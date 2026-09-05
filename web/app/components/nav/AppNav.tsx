"use client"

import { Suspense } from "react"
import Link, { useLinkStatus } from "next/link"
import { useSearchParams } from "next/navigation"
import { HUB_BRAND, HUB_HOME_ARIA_LABEL } from "@/lib/robosprawl/public-config"

function AppNavBrand({ label }: { label: string }) {
	const { pending } = useLinkStatus()

	return (
		<span
			className="app-nav__brand-label"
			data-pending={pending || undefined}>
			{label}
		</span>
	)
}

function AppNavContent({ label }: { label: string }) {
	return (
		<div className="relative z-60 h-[8vh] shrink-0">
			<nav className="app-nav--enter flex h-full items-center justify-center px-12">
				<Link
					href={{
						pathname: "/",
						query: { from: "app" },
					}}
					prefetch
					aria-label={HUB_HOME_ARIA_LABEL}
					data-hud-ignore-dismiss
					className="app-nav__brand app-nav__brand--bar pointer-events-auto p-0">
					<AppNavBrand label={label} />
				</Link>
			</nav>
		</div>
	)
}

function RoutedAppNav() {
	const searchParams = useSearchParams()
	if (searchParams.has("runId")) return null
	return <AppNavContent label={HUB_BRAND} />
}

export function AppNav() {
	return (
		<Suspense fallback={null}>
			<RoutedAppNav />
		</Suspense>
	)
}
