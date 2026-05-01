"use client"

import { ChevronUp } from "lucide-react"

export default function ScrollToTopButton() {
  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className="fixed right-8 bottom-8 rounded-full border bg-white p-3 shadow-lg hover:bg-gray-50"
    >
      <ChevronUp className="h-5 w-5" />
    </button>
  )
}
