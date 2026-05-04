import { useEffect, useState } from "react"

interface UseScrollSpyWindowOptions {
  topOffset?: number
}

export function useScrollSpyWindow(
  sectionIds: string[],
  options: UseScrollSpyWindowOptions = {}
) {
  const { topOffset = 0 } = options
  const [activeId, setActiveId] = useState<string | null>(sectionIds[0] ?? null)

  useEffect(() => {
    if (sectionIds.length === 0) return

    const els = sectionIds
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => Boolean(el))

    if (els.length === 0) return

    const visible = new Set<string>()

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id
          if (entry.isIntersecting) visible.add(id)
          else visible.delete(id)
        }

        const topmost =
          sectionIds.find((id) => visible.has(id)) ??
          sectionIds.reduce<string | null>((acc, id) => {
            const el = document.getElementById(id)
            if (!el) return acc
            const top = el.getBoundingClientRect().top - topOffset
            return top <= 0 ? id : (acc ?? id)
          }, null)

        if (topmost) setActiveId(topmost)
      },
      {
        rootMargin: `-${topOffset}px 0px -60% 0px`,
        threshold: 0,
      }
    )

    els.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [sectionIds, topOffset])

  return activeId
}
