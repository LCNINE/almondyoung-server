"use client"

import { useEffect, useState } from "react"
import { getMyAlmondSavedDesignThumbnail } from "@/lib/api/ugc/almond-saved-designs"
import { cn } from "@/lib/utils"

export function SavedThumbnail({
  id,
  version,
  className,
}: {
  id: string
  version?: string
  className?: string
}) {
  const [svg, setSvg] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    getMyAlmondSavedDesignThumbnail(id)
      .then((value) => !cancelled && setSvg(value))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [id, version])
  return (
    <span
      className={cn(
        "bg-muted flex shrink-0 items-center justify-center",
        className ?? "h-14 w-20"
      )}
    >
      {svg && (
        <img
          src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
          alt=""
          className="max-h-full max-w-full object-contain"
        />
      )}
    </span>
  )
}
