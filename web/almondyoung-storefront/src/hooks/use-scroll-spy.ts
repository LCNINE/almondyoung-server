import { RefObject, useEffect, useState } from "react"

interface UseScrollSpyOptions {
  rootMargin?: string
}

export function useScrollSpy(
  sectionIds: string[],
  rootRef: RefObject<HTMLElement | null>,
  options: UseScrollSpyOptions = {}
) {
  const { rootMargin = "0px 0px -70% 0px" } = options
  const [activeId, setActiveId] = useState<string | null>(sectionIds[0] ?? null)

  useEffect(() => {
    const root = rootRef.current
    if (!root || sectionIds.length === 0) return

    const visible = new Set<string>()
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const id = (entry.target as HTMLElement).dataset.sectionId
          if (!id) return
          if (entry.isIntersecting) visible.add(id)
          else visible.delete(id)
        })
        const topmost = sectionIds.find((id) => visible.has(id))
        if (topmost) setActiveId(topmost)
      },
      { root, rootMargin }
    )

    const els = root.querySelectorAll<HTMLElement>("[data-section-id]")
    els.forEach((el) => observer.observe(el))

    return () => observer.disconnect()
  }, [sectionIds, rootRef, rootMargin])

  return activeId
}
