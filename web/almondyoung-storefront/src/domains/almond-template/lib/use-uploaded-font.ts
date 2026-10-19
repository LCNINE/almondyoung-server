"use client"

import { useEffect, useState } from "react"
import { loadUploadedFont } from "./fonts"

// graphic.tsx 는 서버(문서 검증)에서도 import 하므로 훅은 여기 둔다(image-previews.ts 와 같은 이유)
export function useUploadedFont(
  family: string | undefined,
  onLoaded: () => void
) {
  const [, setLoads] = useState(0)
  useEffect(() => {
    loadUploadedFont(family)?.then(() => {
      onLoaded()
      setLoads((count) => count + 1)
    })
  }, [family])
}
