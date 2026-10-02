import type { RefObject } from "react"
import type { Design } from "../lib/document"

function download(name: string, content: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement("a")
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function svgMarkup(source: SVGSVGElement, design: Design) {
  const clone = source.cloneNode(true) as SVGSVGElement
  clone.querySelector("#print-guides")?.remove()
  clone.querySelector("#selection-outline")?.remove()
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg")
  clone.setAttribute("width", `${design.widthMm}mm`)
  clone.setAttribute("height", `${design.heightMm}mm`)
  return new XMLSerializer().serializeToString(clone)
}

type Params = {
  design: Design
  productId: string
  side: "front" | "back"
  preview: boolean
  previewSide: "front" | "back"
  svgRef: RefObject<SVGSVGElement>
  setMessage: (message: string) => void
}

export function useTemplateExport({
  design,
  productId,
  side,
  preview,
  previewSide,
  svgRef,
  setMessage,
}: Params) {
  const exportJson = () =>
    download(
      `almond-template-${design.productId || design.kind}-${design.widthMm}x${design.heightMm}.json`,
      JSON.stringify(design, null, 2),
      "application/json"
    )
  const exportSvg = () => {
    const source = preview
      ? (document.querySelector(
          '[aria-label="시안 미리보기"] svg'
        ) as SVGSVGElement | null)
      : svgRef.current
    if (!source) return
    download(
      `almond-${productId || design.kind}-${preview ? previewSide : side}.svg`,
      svgMarkup(source, design),
      "image/svg+xml"
    )
    setMessage(
      "SVG는 편집·검토용입니다. 와우프레스 AI/EPS 접수 적합성은 별도 검증이 필요합니다."
    )
  }
  const printProof = () => {
    const svg = document.querySelector(
      '[aria-label="시안 미리보기"] svg'
    ) as SVGSVGElement | null
    if (!svg) return
    const page = window.open("", "_blank")
    if (!page)
      return setMessage(
        "인쇄 창을 열 수 없습니다. 팝업 허용 후 다시 눌러 주세요."
      )
    page.document.title = "아몬드영 시안출력"
    const style = page.document.createElement("style")
    style.textContent =
      "@page{size:A4;margin:10mm}body{margin:0;display:flex;align-items:center;justify-content:center;height:calc(100vh - 20mm)}svg{max-width:100%;max-height:100%;width:auto;height:auto}"
    page.document.head.appendChild(style)
    page.document.body.appendChild(page.document.importNode(svg, true))
    page.document.close()
    setTimeout(() => page.print(), 100)
  }

  return { exportJson, exportSvg, printProof }
}
