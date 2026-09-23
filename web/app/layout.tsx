import type { Metadata } from "next"
import { cookies } from "next/headers"
import { preload } from "react-dom"
import localFont from "next/font/local"
import { HUB_NAME } from "@/lib/robozium/public-config"
import { APP_THEME_COOKIE_NAME, parseAppTheme } from "@/lib/theme"
import { AppNav } from "./components/nav"
import { AppToaster } from "./components/feedback/AppToaster"
import "./globals.css"

const vt323 = localFont({
	src: "../node_modules/@fontsource/vt323/files/vt323-latin-400-normal.woff2",
	variable: "--font-vt323",
	weight: "400",
	display: "swap",
})

const shareTechMono = localFont({
	src: "../node_modules/@fontsource/share-tech-mono/files/share-tech-mono-latin-400-normal.woff2",
	variable: "--font-share-tech-mono",
	weight: "400",
	display: "swap",
})

const sourceCodePro = localFont({
	src: [
		{
			path: "../node_modules/@fontsource/source-code-pro/files/source-code-pro-latin-400-normal.woff2",
			weight: "400",
		},
		{
			path: "../node_modules/@fontsource/source-code-pro/files/source-code-pro-latin-500-normal.woff2",
			weight: "500",
		},
	],
	variable: "--font-source-code-pro",
	display: "swap",
})

// Display face for the top nav / brand only. The bundled file retains the
// SCAN axis used by the chrome while avoiding a build-time Google dependency.
const sixtyfour = localFont({
	src: "../node_modules/@fontsource-variable/sixtyfour/files/sixtyfour-latin-scan-normal.woff2",
	variable: "--font-sixtyfour",
	weight: "400",
	display: "swap",
})

export const metadata: Metadata = {
	title: HUB_NAME,
	description: "Robozium project agent terminal",
}

export default async function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode
}>) {
	const cookieStore = await cookies()
	const theme = parseAppTheme(cookieStore.get(APP_THEME_COOKIE_NAME)?.value)
	preload("/fonts/Anurati-Pro-Regular.woff2", {
		as: "font",
		type: "font/woff2",
		crossOrigin: "anonymous",
	})

	return (
		<html
			lang="en"
			data-theme={theme}
			style={{ colorScheme: theme }}
			className={`${vt323.variable} ${shareTechMono.variable} ${sourceCodePro.variable} ${sixtyfour.variable} h-full antialiased`}>
			<body className="h-dvh flex flex-col bg-term-bg text-term-green font-terminal overflow-hidden">
				{/* CRT layer lives on a plain wrapper, not on <body>. Browsers give
				    root elements a special paint/composite path (viewport background
				    propagation, document-level layer) which in our case produced a
				    wider beat pattern on top of the 3px scanlines. Moving the
				    pseudo-element hosts down one level puts them on a normal stacking
					context and -- if that was the cause -- clears the moire. */}
				<div className="term-scanlines term-vignette relative flex flex-1 flex-col min-h-0">
					<AppNav />
					<AppToaster />
					{children}
				</div>
			</body>
		</html>
	)
}
