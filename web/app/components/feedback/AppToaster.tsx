"use client"

import { Toaster } from "react-hot-toast"

export function AppToaster() {
	return (
		<Toaster
			position="top-center"
			toastOptions={{
				duration: 5000,
				removeDelay: 250,
				ariaProps: {
					role: "status",
					"aria-live": "polite",
				},
			}}
		/>
	)
}
