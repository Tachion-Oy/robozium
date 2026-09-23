import Link from "next/link"
import { HUB_BRAND, HUB_HOME_ARIA_LABEL } from "@/lib/robozium/public-config"
import { DisplayArt } from "../branding/DisplayArt"

type AppNavControlsProps = {
	brandClassName?: string
	ctaClassName?: string
	hubBrand?: string
	hubHomeAriaLabel?: string
}

function joinClasses(...classes: Array<string | undefined>) {
	return classes.filter(Boolean).join(" ")
}

export function AppNavControls({
	brandClassName,
	ctaClassName,
	hubBrand = HUB_BRAND,
	hubHomeAriaLabel = HUB_HOME_ARIA_LABEL,
}: AppNavControlsProps) {
	return (
		<div className="flex flex-col justify-center items-center gap-12">
			<Link
				href="/"
				aria-label={hubHomeAriaLabel}
				className={joinClasses("app-nav__brand", brandClassName)}>
				<DisplayArt name="robozium" label={hubBrand} />
			</Link>
			<Link
				href="/"
				className={joinClasses("app-nav__cta", ctaClassName)}>
				<DisplayArt name="start" />
			</Link>
		</div>
	)
}
