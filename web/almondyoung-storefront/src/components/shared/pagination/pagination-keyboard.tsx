"use client"

import { useEffect } from "react"

export function onPaginationArrowKey(event: KeyboardEvent) {
  if (
    (event.key !== "ArrowLeft" && event.key !== "ArrowRight") ||
    event.defaultPrevented ||
    event.repeat ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    (event.target instanceof Element &&
      event.target.closest(
        'input, textarea, select, [contenteditable], [role="dialog"], [role="combobox"], [role="listbox"], [role="slider"], [role="tab"], [role="menu"]'
      ))
  )
    return

  const direction = event.key === "ArrowLeft" ? "prev" : "next"
  const controls = document.querySelectorAll<HTMLElement>(
    `[data-pagination] [data-page-${direction}]`
  )
  const control = Array.from(controls).find(
    (item) =>
      item.getClientRects().length > 0 &&
      !item.closest('[aria-hidden="true"]') &&
      !item.matches(':disabled, [aria-disabled="true"]')
  )
  if (!control) return

  event.preventDefault()
  control.click()
}

export function PaginationKeyboard() {
  useEffect(() => {
    window.addEventListener("keydown", onPaginationArrowKey)
    return () => window.removeEventListener("keydown", onPaginationArrowKey)
  }, [])

  return null
}
