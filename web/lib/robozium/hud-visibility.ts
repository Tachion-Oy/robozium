import { createStore } from "zustand/vanilla"

/**
 * HUD visibility, pending navigation, and run state shared with the app nav.
 * The nav is mounted outside the per-run session provider, so this state
 * lives in a module-level store.
 */
type HudVisibilityState = {
	open: boolean
	navigationPending: boolean
	runActive: boolean
	prompting: boolean
}

export const hudVisibilityStore = createStore<HudVisibilityState>(() => ({
	open: true,
	navigationPending: false,
	runActive: false,
	prompting: false,
}))

/** Claim synchronously so two clicks in the same event cannot start two runs. */
export function beginHudNavigation(): boolean {
	if (hudVisibilityStore.getState().navigationPending) return false
	hudVisibilityStore.setState({ navigationPending: true })
	return true
}
