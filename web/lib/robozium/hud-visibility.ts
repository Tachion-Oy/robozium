import { createStore } from "zustand/vanilla"

/**
 * HUD open/closed state plus the bits of run state the nav needs. The nav is
 * mounted in the root layout, outside the per-run session provider, so this
 * lives in its own module-level store.
 */
type HudVisibilityState = {
	open: boolean
	runActive: boolean
	prompting: boolean
}

export const hudVisibilityStore = createStore<HudVisibilityState>(() => ({
	open: true,
	runActive: false,
	prompting: false,
}))
