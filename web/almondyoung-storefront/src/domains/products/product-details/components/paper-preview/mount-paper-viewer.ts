import type { ModelViewerElement } from "@google/model-viewer"
import { getAlmondTemplate } from "@/lib/api/ugc/almond-templates"
import { parseDesign, printsBack } from "@/domains/almond-template/lib/document"
import { printSvg } from "@/domains/almond-template/components/print-svg"
import { rasterPng } from "@/domains/almond-template/lib/design-images"
import { mountViewer } from "../model3d-viewer/mount-viewer"
import { PAPER_MODELS, type PaperShape, type PaperVariant } from "./paper"

type PaperViewerOptions = {
  templateId: string
  shape: PaperShape
  alt: string
  interactionPrompt: string
  variant: () => PaperVariant
  onReady: () => void
  onError: () => void
}

const FIELD_OF_VIEW = "28deg"

export async function mountPaperViewer(
  container: HTMLElement,
  {
    templateId,
    shape,
    alt,
    interactionPrompt,
    variant,
    onReady,
    onError,
  }: PaperViewerOptions
) {
  const model = PAPER_MODELS[shape]

  let disposed = false
  let loaded = false
  const urls: string[] = []

  const hydrate = async () => {
    const viewer = container.querySelector<ModelViewerElement>("model-viewer")
    if (disposed || loaded || !viewer?.model) return

    loaded = true
    const faces = viewer.model.materials.filter(
      (material) =>
        material.name === "card_front" || material.name === "card_back"
    )
    await Promise.all(faces.map((material) => material.ensureLoaded()))
    if (disposed) return

    const canvas = document.createElement("canvas")
    canvas.width = 90
    canvas.height = 50
    const context = canvas.getContext("2d")
    if (!context) throw new Error("Canvas 2D is not available")

    context.fillStyle = "white"
    context.fillRect(0, 0, canvas.width, canvas.height)
    const plain = await viewer.createTexture(canvas.toDataURL("image/png"))
    if (!plain) throw new Error("Paper texture is not available")
    if (disposed) return

    for (const material of faces) {
      material.pbrMetallicRoughness.baseColorTexture?.setTexture(plain)
    }
    // 공통 뷰어가 붙인 먼 카메라(150%)가 로드 때 다시 잡히므로, 로드 뒤에 명함 거리로 당긴다
    viewer.cameraOrbit = model.cameraOrbit
    viewer.fieldOfView = FIELD_OF_VIEW
    viewer.jumpCameraToGoal()
    onReady()

    // Artwork is optional; keep both faces plain if fonts, images or the API fail.
    try {
      const template = await getAlmondTemplate(templateId)
      if (disposed) return

      const design = parseDesign(template.design)
      const [frontBlob, backBlob] = await Promise.all([
        printSvg(design, "front", 0).then((markup) => rasterPng(markup, 1600)),
        printsBack(design)
          ? printSvg(design, "back", 0).then((markup) =>
              rasterPng(markup, 1600)
            )
          : undefined,
      ])
      if (disposed) return

      const texture = (blob: Blob) => {
        const url = URL.createObjectURL(blob)
        urls.push(url)

        return viewer.createTexture(url)
      }
      const [front, back] = await Promise.all([
        texture(frontBlob),
        backBlob ? texture(backBlob) : plain,
      ])
      if (disposed || !front || !back) return

      for (const material of faces) {
        material.pbrMetallicRoughness.baseColorTexture?.setTexture(
          material.name === "card_front" ? front : back
        )
      }
    } catch {
      // The close-ups remain the primary paper information.
    }
  }

  const disposeViewer = await mountViewer(container, {
    src: model.src,
    alt,
    onLoad: () =>
      void hydrate().catch(() => {
        if (!disposed) onError()
      }),
    onError,
  })
  const viewer = container.querySelector<ModelViewerElement>("model-viewer")!
  viewer.variantName = variant()
  viewer.setAttribute("environment-image", "neutral")
  viewer.setAttribute("exposure", "1.15")
  viewer.setAttribute("camera-orbit", model.cameraOrbit)
  viewer.setAttribute("min-camera-orbit", "auto auto 0.08m")
  viewer.setAttribute("field-of-view", FIELD_OF_VIEW)
  viewer.setAttribute("touch-action", "pan-y")
  viewer.setAttribute("rotation-per-second", "8deg")
  viewer.setAttribute("auto-rotate-delay", "0")
  viewer.setAttribute("interaction-prompt", "none")
  viewer.a11y = JSON.stringify({
    ...Object.fromEntries(
      ["front", "back", "left", "right"].flatMap((side) =>
        [side, `upper-${side}`, `lower-${side}`].map((key) => [key, alt])
      )
    ),
    "interaction-prompt": interactionPrompt,
  })

  const motion = window.matchMedia("(prefers-reduced-motion: reduce)")
  const updateMotion = () =>
    viewer.toggleAttribute("auto-rotate", !motion.matches)
  updateMotion()
  motion.addEventListener("change", updateMotion)

  return () => {
    disposed = true
    motion.removeEventListener("change", updateMotion)
    disposeViewer()
    urls.forEach((url) => URL.revokeObjectURL(url))
  }
}
