import type { Design, Layer } from "./document"
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
    return uploadBlob(await imageBlob(session))
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

async function downscaled(blob: Blob) {
  const bitmap = await createImageBitmap(blob)
  const scale = Math.min(
    1,
    THUMBNAIL_MAX_PX / Math.max(bitmap.width, bitmap.height)
  )
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL("image/webp", 0.85)
}

export async function rasterThumbnail(
  markup: string,
  previews: Readonly<Record<string, string>> = {}
) {
  const svg = new DOMParser().parseFromString(markup, "image/svg+xml")
  await Promise.all(
    Array.from(svg.querySelectorAll("image")).map(async (node) => {
      const href = node.getAttribute("href") ?? ""
      const fileId = href.match(/\/files\/public\/([0-9a-f-]{36})/)?.[1]
      const source = fileId ? fileImageRef(fileId) : href
      if (!source.startsWith("data:") && !fileId) return node.remove()
      node.setAttribute(
        "href",
        await downscaled(await imageBlob(previewOf(source, previews)))
      )
    })
  )
  const root = svg.documentElement
  const [, , viewWidth, viewHeight] = (root.getAttribute("viewBox") ?? "")
    .split(/[\s,]+/)
    .map(Number)
  const scale = THUMBNAIL_MAX_PX / Math.max(viewWidth, viewHeight)
  const width = Math.max(1, Math.round(viewWidth * scale))
  const height = Math.max(1, Math.round(viewHeight * scale))
  root.setAttribute("width", String(width))
  root.setAttribute("height", String(height))
  const image = new Image()
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`
  await image.decode()
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  canvas.getContext("2d")!.drawImage(image, 0, 0, width, height)
  const raster = canvas.toDataURL("image/webp", 0.85)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><image href="${raster}" width="${width}" height="${height}"/></svg>`
}
