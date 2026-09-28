import { useState } from "react"
import { clearWhiteBackdrop } from "./clear-white-backdrop"

export function useStickerSrc() {
  const [stickerSrcById, setStickerSrcById] = useState<Record<string, string>>(
    {}
  )

  const prepareSticker = (image: HTMLImageElement, fileId: string) => {
    if (stickerSrcById[fileId] || !image.naturalWidth) return
    const canvas = document.createElement("canvas")
    canvas.width = Math.min(image.naturalWidth, 192)
    canvas.height = Math.round(
      (canvas.width * image.naturalHeight) / image.naturalWidth
    )
    const context = canvas.getContext("2d")
    if (!context) return
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    try {
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
      if (!clearWhiteBackdrop(imageData.data, canvas.width, canvas.height))
        return
      context.putImageData(imageData, 0, 0)
      setStickerSrcById((current) => ({
        ...current,
        [fileId]: canvas.toDataURL("image/png"),
      }))
    } catch {
      // 원격 이미지가 캔버스 읽기를 허용하지 않으면 원본을 표시한다.
    }
  }

  return { stickerSrcById, prepareSticker }
}
