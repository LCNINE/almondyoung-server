"use client"

import { cn } from "@/lib/utils"
import { useEffect, useRef, useState } from "react"

type Props = {
  content: string
}

export function ExpandableReviewContent({ content }: Props) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isClamped, setIsClamped] = useState(false)
  const contentRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    setIsClamped(el.scrollHeight > el.clientHeight)
  }, [content])

  return (
    <div className="relative">
      <p
        ref={contentRef}
        className={cn("text-xs text-black", !isExpanded && "line-clamp-4")}
      >
        {content.split("\n").map((line, i) => (
          <span key={i} className="block">
            {line || "\u00A0"}
          </span>
        ))}
      </p>

      {isClamped && !isExpanded && (
        <button
          type="button"
          onClick={() => setIsExpanded(true)}
          className="mt-1 text-xs font-medium text-gray-400"
        >
          ... 더 보기
        </button>
      )}
    </div>
  )
}
