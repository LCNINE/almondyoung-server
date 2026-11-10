import type { Design, Layer } from "./document"
import {
  failureStageOf,
  retryTransient,
  withFailureContext,
} from "../hooks/use-auth-retry"
import { embeddedFontCss, firstFamily } from "./fonts"
import {
  ALMOND_TEMPLATE_IMAGE_CONTEXT_ID,
  fileImageRef,
  imageBlob,
  imageFileId,
} from "./image-ref"
import {
  previewOf,
  rememberPreview,
  sessionPreview,
  shareSessionPreview,
} from "./image-previews"

type Upload = (formData: FormData) => Promise<{ id: string }>

const THUMBNAIL_MAX_PX = 800

// backfill: 축소본 없이 저장돼 있던 file: 원본도 이번에 축소본을 만든다(원본을 내려받아 디코딩한다)
export async function uploadDesignImages(
  design: Design,
  upload: Upload,
  { backfill = false } = {}
): Promise<Design> {
  const uploadBlob = async (blob: Blob) => {
    const formData = new FormData()
    formData.append(
      "file",
      blob,
      `almond-template.${blob.type.split("/")[1] ?? "png"}`
    )
    formData.append("contextId", ALMOND_TEMPLATE_IMAGE_CONTEXT_ID)
    return fileImageRef((await upload(formData)).id)
  }
  const previews: Record<string, string> = {}
  const previewFor = async (value: string, ref: string) => {
    const known = design.imagePreviews?.[value]
    if (known) return known
    if (backfill && imageFileId(value) && !sessionPreview(value)) {
      try {
        const bitmap = await createImageBitmap(await imageBlob(value))
        await rememberPreview(value, bitmap).finally(() => bitmap.close())
      } catch {
        return undefined
      }
    }
    const session = sessionPreview(value)
    if (!session) return undefined
    shareSessionPreview(value, ref)
    // 축소본은 화면을 빠르게 하는 보조물이라, 못 올리면 원본만으로 저장한다
    try {
      return await uploadBlob(await imageBlob(session))
    } catch {
      return undefined
    }
  }
  const refs = new Map<string, Promise<string>>()
  const store = (value: string | undefined) => {
    if (!value) return value
    if (!refs.has(value))
      refs.set(
        value,
        (async () => {
          const ref = value.startsWith("data:")
            ? await uploadBlob(await imageBlob(value))
            : value
          const preview = await previewFor(value, ref)
          if (preview) previews[ref] = preview
          return ref
        })()
      )
    return refs.get(value)
  }
  const layer = async (item: Layer): Promise<Layer> => ({
    ...item,
    image: await store(item.image),
    originalImage: await store(item.originalImage),
  })
  const [front, back, backgroundImage, backBackgroundImage] = await Promise.all(
    [
      Promise.all(design.front.map(layer)),
      Promise.all(design.back.map(layer)),
      store(design.backgroundImage),
      store(design.backBackground?.backgroundImage),
    ]
  )
  return {
    ...design,
    imagePreviews: Object.keys(previews).length ? previews : undefined,
    front,
    back,
    backgroundImage,
    ...(design.backBackground && {
      backBackground: {
        ...design.backBackground,
        backgroundImage: backBackgroundImage,
      },
    }),
  }
}

async function downscaled(blob: Blob, maxPx: number) {
  const bitmap = await createImageBitmap(blob)
  const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL("image/webp", 0.85)
}

async function rasterize(
  markup: string,
  previews: Readonly<Record<string, string>>,
  maxPx: number,
  { lenient = false } = {}
) {
  const svg = new DOMParser().parseFromString(markup, "image/svg+xml")
  await Promise.all(
    Array.from(svg.querySelectorAll("image")).map(async (node) => {
      const href = node.getAttribute("href") ?? ""
      const fileId = href.match(/\/files\/public\/([0-9a-f-]{36})/)?.[1]
      const source = fileId ? fileImageRef(fileId) : href
      if (!source.startsWith("data:") && !fileId) return node.remove()
      // 클립아트 SVG 는 createImageBitmap 이 디코딩하지 못하고, 자체 완결이라 그대로 그려도 된다
      if (source.startsWith("data:image/svg+xml")) return

      try {
        const blob = await retryTransient(() =>
          imageBlob(previewOf(source, previews))
        )
        node.setAttribute("href", await downscaled(blob, maxPx))
      } catch (error) {
        // 썸네일은 사진 하나를 못 읽어도 나머지로 그린다(인쇄용 PNG 는 빠지면 안 되므로 그대로 실패)
        if (!lenient)
          throw withFailureContext(error, {
            stage: "image",
            image: fileId ? `file:${fileId}` : "inline",
          })
        node.remove()
      }
    })
  )
  const root = svg.documentElement
  const css = await embeddedFontCss(
    Array.from(svg.querySelectorAll("[font-family]"), (node) =>
      firstFamily(node.getAttribute("font-family") ?? "")
    ),
    Array.from(
      svg.querySelectorAll("text"),
      (node) => node.textContent ?? ""
    ).join("")
  )
  if (css) {
    const style = svg.createElementNS("http://www.w3.org/2000/svg", "style")
    style.textContent = css
    root.prepend(style)
  }

  const [, , viewWidth, viewHeight] = (root.getAttribute("viewBox") ?? "")
    .split(/[\s,]+/)
    .map(Number)
  const scale = maxPx / Math.max(viewWidth, viewHeight)
  const width = Math.max(1, Math.round(viewWidth * scale))
  const height = Math.max(1, Math.round(viewHeight * scale))
  root.setAttribute("width", String(width))
  root.setAttribute("height", String(height))
  const markupText = new XMLSerializer().serializeToString(svg)
  const image = new Image()
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markupText)}`
  await image.decode().catch((error: unknown) => {
    throw withFailureContext(
      error instanceof Error ? error : new Error("SVG decode failed"),
      { stage: "decode", maxPx, markupLength: markupText.length }
    )
  })
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  canvas.getContext("2d")!.drawImage(image, 0, 0, width, height)
  return canvas
}

const THUMBNAIL_MAX_CHARS = 2_000_000

export async function rasterThumbnail(
  markup: string,
  previews: Readonly<Record<string, string>> = {}
) {
  const canvas = await rasterize(markup, previews, THUMBNAIL_MAX_PX, {
    lenient: true,
  })
  const { width, height } = canvas
  let raster = canvas.toDataURL("image/webp", 0.85)
  if (raster.length > THUMBNAIL_MAX_CHARS)
    raster = canvas.toDataURL("image/webp", 0.5)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><image href="${raster}" width="${width}" height="${height}"/></svg>`
}

// 썸네일은 목록 카드용이라 못 그려도 저장을 막지 않는다. 그리기에 실패하면 바탕색만 칠한 카드로 저장한다
export function placeholderThumbnail(
  widthMm: number,
  heightMm: number,
  background = "#ffffff"
) {
  const scale = THUMBNAIL_MAX_PX / Math.max(widthMm, heightMm, 1)
  const width = Math.max(1, Math.round(widthMm * scale))
  const height = Math.max(1, Math.round(heightMm * scale))
  const fill = /^#[0-9a-f]{3,8}$/i.test(background) ? background : "#ffffff"
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${fill}"/></svg>`
}

// 큰 해상도에서 그리기·인코딩에 실패하는 브라우저가 있어, 사진을 못 읽은 경우가 아니면 해상도를 낮춰 다시 그린다
export async function rasterPng(markup: string, maxPx: number) {
  let last: unknown
  for (const px of [maxPx, Math.round(maxPx * 0.66), Math.round(maxPx * 0.4)]) {
    try {
      const canvas = await rasterize(markup, {}, px)
      const png = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png")
      )
      if (png) return png
      last = withFailureContext(new Error("PNG encode failed"), {
        stage: "encode",
        maxPx: px,
      })
    } catch (error) {
      // 사진을 못 읽은 건 해상도와 상관없다
      if (failureStageOf(error) === "image") throw error
      last = error
    }
  }
  throw last
}
