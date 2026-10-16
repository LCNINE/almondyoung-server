"use client"

import { createContext, useContext } from "react"
import { imageSrc } from "./image-ref"

// ponytail: 최대 확대(8배)에서는 축소본이 살짝 흐리다. 문제 되면 확대 배율에 따라 원본으로 바꿔 그릴 것
export const PREVIEW_MAX_PX = 4096

// Provider 밖(printSvg)은 언제나 원본을 그린다
export const ImagePreviews = createContext<Readonly<
  Record<string, string>
> | null>(null)

// 아직 저장 전인 사진의 축소본. 원본 값(data: 또는 file:) → blob: URL
const sessionPreviews = new Map<string, string>()

export const sessionPreview = (value: string) => sessionPreviews.get(value)

export function previewOf(
  value: string,
  previews: Readonly<Record<string, string>>
) {
  return sessionPreviews.get(value) ?? previews[value] ?? value
}

export function useImageSrc() {
  const previews = useContext(ImagePreviews)
  return (value: string) =>
    imageSrc(previews ? previewOf(value, previews) : value)
}

export async function rememberPreview(
  value: string,
  source: ImageBitmap | HTMLCanvasElement
) {
  const scale = PREVIEW_MAX_PX / Math.max(source.width, source.height)
  if (scale >= 1 || sessionPreviews.has(value)) return
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(source.width * scale))
  canvas.height = Math.max(1, Math.round(source.height * scale))
  canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.9)
  )
  if (blob) sessionPreviews.set(value, URL.createObjectURL(blob))
}

export function shareSessionPreview(from: string, to: string) {
  const url = sessionPreviews.get(from)
  if (url) sessionPreviews.set(to, url)
}
