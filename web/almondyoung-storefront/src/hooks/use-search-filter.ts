import { useDeferredValue, useMemo, useState } from "react"

export function useSearchFilter<T>(
  items: T[],
  getSearchText: (item: T) => string
) {
  const [input, setInput] = useState("")
  const deferred = useDeferredValue(input)

  const filtered = useMemo(() => {
    const q = deferred.trim().toLowerCase()
    if (!q) return items
    return items.filter((item) => getSearchText(item).toLowerCase().includes(q))
  }, [items, deferred, getSearchText])

  return { input, setInput, filtered }
}
