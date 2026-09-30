import { useState } from "react"
import type { Design, Layer } from "../lib/document"
import { makeLayer } from "../lib/layer"

type Params = {
  design: Design
  side: "front" | "back"
  layers: Layer[]
  selected: Layer | undefined
  change: (design: Design) => void
  patch: (id: string, value: Partial<Layer>) => void
  setSelectedId: (id: string | null) => void
  setMessage: (message: string) => void
}

export function useImageTools({
  design,
  side,
  layers,
  selected,
  change,
  patch,
  setSelectedId,
  setMessage,
}: Params) {
  const [uploadedImages, setUploadedImages] = useState<
    Array<{ image: string; pixelWidth: number; pixelHeight: number }>
  >([])
  const imageLibrary = [
    ...uploadedImages,
    ...[...design.front, ...design.back]
      .filter(
        (layer) =>
          (layer.type === "image" || layer.type === "frame") &&
          layer.image &&
          layer.pixelWidth &&
          layer.pixelHeight
      )
      .map((layer) => ({
        image: layer.originalImage ?? layer.image!,
        pixelWidth: layer.pixelWidth!,
        pixelHeight: layer.pixelHeight!,
      })),
  ].filter(
    (item, index, items) =>
      items.findIndex((other) => other.image === item.image) === index
  )
  const imageFile = async (
    file: File,
    target: "layer" | "background" | "frame" = "layer"
  ) => {
    if (!file.type.match(/^image\/(png|jpeg|webp)$/) || file.size > 5_000_000) {
      setMessage("PNG/JPG/WebP 5MB 이하 이미지만 사용할 수 있습니다.")
      return
    }
    try {
      const bitmap = await createImageBitmap(file)
      const pixelWidth = bitmap.width,
        pixelHeight = bitmap.height
      bitmap.close()
      const reader = new FileReader()
      reader.onload = () => {
        const image = String(reader.result)
        if (target !== "background")
          setUploadedImages((items) => [
            ...items.slice(-19),
            { image, pixelWidth, pixelHeight },
          ])
        if (target === "background")
          change({
            ...design,
            backgroundImage: image,
            backgroundPixelWidth: pixelWidth,
            backgroundPixelHeight: pixelHeight,
          })
        else if (target === "frame" && selected)
          patch(selected.id, {
            image,
            pixelWidth,
            pixelHeight,
            originalImage: undefined,
            imageFilter: undefined,
          })
        else
          setMessage(
            "내 라이브러리에 사진을 추가했습니다. 사진을 누르거나 자동담기를 사용하세요."
          )
      }
      reader.readAsDataURL(file)
    } catch {
      setMessage(
        "이미지를 읽지 못했습니다. 다른 PNG 또는 JPG 파일을 사용하세요."
      )
    }
  }
  const fillFrames = () => {
    if (!imageLibrary.length) return setMessage("먼저 이미지를 업로드하세요.")
    let nextImage = 0
    const nextLayers = layers.map((layer) =>
      layer.type === "frame" && !layer.image && nextImage < imageLibrary.length
        ? { ...layer, ...imageLibrary[nextImage++] }
        : layer
    )
    if (!nextImage) {
      const photo = imageLibrary[0]
      if (selected?.type === "image") {
        const selectedPhoto =
          selected.image && selected.pixelWidth && selected.pixelHeight
            ? {
                image: selected.image,
                pixelWidth: selected.pixelWidth,
                pixelHeight: selected.pixelHeight,
              }
            : photo
        change({
          ...design,
          [side]: layers.map((layer) =>
            layer.id === selected.id
              ? {
                  ...layer,
                  type: "frame" as const,
                  name: "모양틀",
                  frameShape: "rect" as const,
                  ...selectedPhoto,
                }
              : layer
          ),
        })
        return setMessage("선택한 사진을 모양틀로 바꿔 담았습니다.")
      }
      if (layers.some((layer) => layer.type === "frame"))
        return setMessage("모든 모양틀에 사진이 담겨 있습니다.")
      const frame = {
        ...makeLayer("frame", design),
        frameShape: "rect" as const,
        ...photo,
      }
      change({ ...design, [side]: [...layers, frame] })
      setSelectedId(frame.id)
      return setMessage("빈 모양틀이 없어 사진용 모양틀을 새로 만들었습니다.")
    }
    change({ ...design, [side]: nextLayers })
    setMessage(`${nextImage}개 모양틀에 사진을 담았습니다.`)
  }
  const removeWhiteBackground = async () => {
    if (!selected?.image) return setMessage("먼저 이미지를 선택하세요.")
    try {
      const bitmap = await createImageBitmap(
        await (await fetch(selected.image)).blob()
      )
      if (bitmap.width * bitmap.height > 20_000_000) {
        bitmap.close()
        return setMessage("배경 제거는 2천만 화소 이하에서 사용할 수 있습니다.")
      }
      const canvas = document.createElement("canvas")
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const context = canvas.getContext("2d")
      if (!context) throw new Error("canvas")
      context.drawImage(bitmap, 0, 0)
      bitmap.close()
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
      let changed = 0
      for (let i = 0; i < pixels.data.length; i += 4) {
        const white = Math.min(
          pixels.data[i],
          pixels.data[i + 1],
          pixels.data[i + 2]
        )
        if (white > 225) {
          pixels.data[i + 3] = Math.round(
            (pixels.data[i + 3] * (245 - white)) / 20
          )
          changed++
        }
      }
      if (!changed)
        return setMessage(
          "흰색 배경이 보이지 않습니다. 투명 PNG를 업로드하세요."
        )
      context.putImageData(pixels, 0, 0)
      const image = canvas.toDataURL("image/png")
      if (image.length > 8_000_000)
        return setMessage(
          "결과 이미지가 너무 큽니다. 작은 이미지를 사용하세요."
        )
      patch(selected.id, {
        image,
        originalImage: undefined,
        imageFilter: undefined,
      })
      setMessage("흰색 배경을 투명하게 바꿨습니다. 가장자리를 확인하세요.")
    } catch {
      setMessage("배경을 제거하지 못했습니다. 투명 PNG를 사용하세요.")
    }
  }
  const applyImageFilter = async (
    filter: NonNullable<Layer["imageFilter"]>,
    level = 50
  ) => {
    if (!selected?.image) return
    try {
      const bitmap = await createImageBitmap(
        await (await fetch(selected.originalImage ?? selected.image)).blob()
      )
      if (bitmap.width * bitmap.height > 20_000_000) {
        bitmap.close()
        return setMessage("필터는 2천만 화소 이하에서 사용할 수 있습니다.")
      }
      const canvas = document.createElement("canvas")
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const context = canvas.getContext("2d")
      if (!context) throw new Error("canvas")
      if (filter !== "emboss") {
        const blurRadius = Math.min(
          80,
          Math.max(2, Math.round(Math.min(bitmap.width, bitmap.height) * 0.025))
        )
        context.filter = {
          grayscale: "grayscale(1)",
          boxblur: `blur(${blurRadius}px)`,
          brightness: `brightness(${0.5 + level / 100})`,
          sepia: "sepia(1)",
        }[filter]
      }
      context.drawImage(bitmap, 0, 0)
      bitmap.close()
      if (filter === "emboss") {
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
        const source = pixels.data.slice()
        for (let y = 1; y < canvas.height - 1; y++)
          for (let x = 1; x < canvas.width - 1; x++)
            for (let channel = 0; channel < 3; channel++) {
              const index = (y * canvas.width + x) * 4 + channel
              pixels.data[index] =
                128 +
                source[index + canvas.width * 4 + 4] -
                source[index - canvas.width * 4 - 4]
            }
        context.putImageData(pixels, 0, 0)
      }
      const image = canvas.toDataURL("image/png")
      if (image.length > 8_000_000)
        return setMessage("필터 결과가 너무 큽니다. 작은 이미지를 사용하세요.")
      patch(selected.id, {
        image,
        originalImage: selected.originalImage ?? selected.image,
        imageFilter: filter,
      })
      setMessage(
        "이미지 필터를 적용했습니다. 'No filter'로 원본을 복원할 수 있습니다."
      )
    } catch {
      setMessage("필터를 적용하지 못했습니다.")
    }
  }

  return {
    imageLibrary,
    imageFile,
    fillFrames,
    removeWhiteBackground,
    applyImageFilter,
  }
}
