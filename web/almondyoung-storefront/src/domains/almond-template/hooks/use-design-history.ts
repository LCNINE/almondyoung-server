import { useState } from "react"
import type { Design } from "../lib/document"

export function useDesignHistory(initial: () => Design) {
  const [design, setDesign] = useState<Design>(initial)
  const [history, setHistory] = useState<Design[]>([])
  const [future, setFuture] = useState<Design[]>([])

  const change = (next: Design) => {
    setHistory((items) => [...items.slice(-29), design])
    setFuture([])
    setDesign(next)
  }
  const undo = () => {
    const prev = history.at(-1)
    if (prev) {
      setHistory(history.slice(0, -1))
      setFuture([design, ...future])
      setDesign(prev)
    }
  }
  const redo = () => {
    const next = future[0]
    if (next) {
      setFuture(future.slice(1))
      setHistory([...history, design])
      setDesign(next)
    }
  }

  return { design, setDesign, history, setHistory, future, change, undo, redo }
}
