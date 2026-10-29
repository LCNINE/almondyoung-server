import { ModelViewerElement } from "@google/model-viewer"

type ViewerOptions = {
  src: string
  alt: string
  onLoad: () => void
  onError: () => void
}

export async function mountViewer(
  container: HTMLElement,
  { src, alt, onLoad, onError }: ViewerOptions
): Promise<() => void> {
  // 뷰어는 WebGL 초기화 실패에도 load를 보낼 수 있어, 빈 화면 대신 오류를 보여준다.
  const canvas = document.createElement("canvas")
  const context = canvas.getContext("webgl2")

  if (!context) {
    throw new Error("WebGL 2 is not available")
  }

  context.getExtension("WEBGL_lose_context")?.loseContext()

  // meshopt은 기본 활성화가 아니므로 첫 모델을 만들기 전에 디코더를 지정한다.
  ModelViewerElement.meshoptDecoderLocation =
    "https://cdn.jsdelivr.net/npm/meshoptimizer@0.24.0/meshopt_decoder.js"
  ModelViewerElement.modelCacheSize = 0

  const viewer = document.createElement("model-viewer") as ModelViewerElement
  viewer.setAttribute("camera-controls", "")
  viewer.setAttribute("touch-action", "pan-y")
  viewer.setAttribute("loading", "eager")
  viewer.setAttribute("alt", alt)
  viewer.style.width = "100%"
  viewer.style.height = "100%"
  viewer.addEventListener("load", onLoad)
  viewer.addEventListener("error", onError)
  viewer.src = src
  container.append(viewer)

  return () => {
    viewer.removeEventListener("load", onLoad)
    viewer.removeEventListener("error", onError)
    viewer.src = null
    viewer.remove()
  }
}
