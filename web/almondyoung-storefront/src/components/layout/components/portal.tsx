// @modules/layout/components/portal.tsx
"use client"

import { createPortal } from "react-dom"
import { useEffect, useState, ReactNode } from "react"

export default function Portal({
  children,
  rootId = "menu-root",
}: { children: ReactNode; rootId?: string }) {
  const [root, setRoot] = useState<HTMLElement | null>(null)

  useEffect(() => {
    const el = document.getElementById(rootId)
    if (!el) {
      console.warn(`#${rootId} not found. Falling back to document.body`)
      setRoot(document.body)                 // ⬅️ 폴백
    } else {
      setRoot(el)
    }
  }, [rootId])

  if (!root) return null
  return createPortal(children, root)
}
