// A set of project slugs marked by pending local work.
import { useCallback, useMemo, useState } from "react"

export interface SlugSet {
	slugs: ReadonlySet<string>
	add: (slug: string) => void
	remove: (slug: string) => void
	/** Keep only the slugs a listing still justifies. */
	retain: (keep: (slug: string) => boolean) => void
}

export function useSlugSet(): SlugSet {
	const [slugs, setSlugs] = useState<ReadonlySet<string>>(() => new Set())
	const add = useCallback((slug: string) => setSlugs(current => new Set(current).add(slug)), [])
	const remove = useCallback((slug: string) => setSlugs(current => {
		if (!current.has(slug)) return current
		const next = new Set(current)
		next.delete(slug)
		return next
	}), [])
	const retain = useCallback((keep: (slug: string) => boolean) => setSlugs(current => {
		const next = new Set([...current].filter(keep))
		return next.size === current.size ? current : next
	}), [])
	return useMemo(() => ({ slugs, add, remove, retain }), [slugs, add, remove, retain])
}
