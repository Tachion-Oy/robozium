"use client"

import { Suspense, useState } from "react"
import Link, { useLinkStatus } from "next/link"
import { useSearchParams } from "next/navigation"
import { HUB_BRAND, HUB_HOME_ARIA_LABEL } from "@/lib/robozium/public-config"
import { DisplayArt } from "../branding/DisplayArt"

function AppNavBrand({ label }: { label: string }) {
	const { pending } = useLinkStatus()

	return (
		<span
			className="app-nav__brand-label"
			data-pending={pending || undefined}>
			<span
				className="app-nav__brand-art"
				aria-hidden="true">
				<DisplayArt
					name="robozium"
					decorative
				/>
			</span>
			<span className="sr-only">{label}</span>
		</span>
	)
}

function AppNavContent({
	label,
	playLandingIntro,
}: {
	label: string
	playLandingIntro: boolean
}) {
	return (
		<div className={`app-nav__row relative z-60 shrink-0${playLandingIntro ? "" : " app-nav__row--return"}`}>
			<nav className="flex h-full items-center justify-center px-(--landing-nav-inset)">
				<Link
					href={{
						pathname: "/",
						query: { from: "app" },
					}}
					prefetch
					aria-label={HUB_HOME_ARIA_LABEL}
					data-hud-ignore-dismiss
					className={`app-nav__brand app-nav__brand--bar pointer-events-auto p-0${playLandingIntro ? " app-nav__brand--enter" : ""}`}>
					<AppNavBrand label={label} />
				</Link>
			</nav>
		</div>
	)
}

function RoutedAppNav() {
	const searchParams = useSearchParams()
	const runId = searchParams.get("runId")
	const [intro, setIntro] = useState(() => ({
		runId,
		play: runId === null && searchParams.get("from") !== "app",
	}))
	if (intro.runId !== runId) setIntro({ runId, play: false })
	if (runId !== null) return null
	return (
		<AppNavContent
			label={HUB_BRAND}
			playLandingIntro={intro.play}
		/>
	)
}

export function AppNav() {
	return (
		<Suspense fallback={null}>
			<RoutedAppNav />
		</Suspense>
	)
}
