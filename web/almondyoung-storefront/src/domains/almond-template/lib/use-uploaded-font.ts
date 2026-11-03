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

  // 구글 글꼴도 늦게 도착한다. 대체 글꼴로 재서 줄여 그린 글자를 다시 그린다
  useEffect(() => {
    const redraw = () => setLoads((count) => count + 1)
    document.fonts?.addEventListener("loadingdone", redraw)

    return () => document.fonts?.removeEventListener("loadingdone", redraw)
  }, [])
}
