import Link from "next/link"
import { HUB_BRAND, HUB_HOME_ARIA_LABEL } from "@/lib/robosprawl/public-config"

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
				{hubBrand}
			</Link>
			<Link
				href="/"
				className={joinClasses("app-nav__cta", ctaClassName)}>
				START
			</Link>
		</div>
	)
}
