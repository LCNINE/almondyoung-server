import type { Design, Layer } from "./document"
import {
  ALMOND_TEMPLATE_IMAGE_CONTEXT_ID,
  fileImageRef,
  imageBlob,
} from "./image-ref"

type Upload = (formData: FormData) => Promise<{ id: string }>

const THUMBNAIL_MAX_PX = 800

export async function uploadDesignImages(
  design: Design,
  upload: Upload
): Promise<Design> {
  const refs = new Map<string, Promise<string>>()
  const store = (value: string | undefined) => {
    if (!value?.startsWith("data:")) return value
    if (!refs.has(value))
      refs.set(
        value,
        (async () => {
          const blob = await imageBlob(value)
          const formData = new FormData()
          formData.append(
            "file",
            blob,
            `almond-template.${blob.type.split("/")[1] ?? "png"}`
          )
          formData.append("contextId", ALMOND_TEMPLATE_IMAGE_CONTEXT_ID)
          return fileImageRef((await upload(formData)).id)
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

export async function rasterThumbnail(markup: string) {
  const svg = new DOMParser().parseFromString(markup, "image/svg+xml")
  await Promise.all(
    Array.from(svg.querySelectorAll("image")).map(async (node) => {
      const href = node.getAttribute("href") ?? ""
      const fileId = href.match(/\/files\/public\/([0-9a-f-]{36})/)?.[1]
      const source = fileId ? fileImageRef(fileId) : href
      if (!source.startsWith("data:") && !fileId) return node.remove()
      node.setAttribute("href", await downscaled(await imageBlob(source)))
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
