import { createStore } from "zustand/vanilla"

type HudSizeState = {
	progress: number
}

/** User-selected size, shared across views for this client runtime. */
export const hudSizeStore = createStore<HudSizeState>(() => ({
	progress: 0,
}))

export function setHudSizeProgress(progress: number) {
	hudSizeStore.setState({ progress: Math.min(1, Math.max(0, progress)) })
}
