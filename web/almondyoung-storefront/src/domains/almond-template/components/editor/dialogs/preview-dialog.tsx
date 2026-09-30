import { X } from "lucide-react"
import { LayerGraphic } from "../../graphic"
import type { AlmondEditor } from "../../../hooks/use-almond-editor"

export function PreviewDialog({ editor }: { editor: AlmondEditor }) {
  const {
    mode,
    design,
    previewSide,
    setPreviewSide,
    setPreview,
    exportJson,
    exportSvg,
    printProof,
  } = editor
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="시안 미리보기"
      className="absolute inset-0 z-20 flex flex-col bg-white"
    >
      <div className="flex h-16 items-center justify-between border-b px-6">
        <strong>
          시안 미리보기 · {previewSide === "front" ? "앞면" : "뒷면"}
        </strong>
        <div className="flex gap-2">
          <button
            className={`border px-3 py-1 ${previewSide === "front" ? "bg-slate-900 text-white" : ""}`}
            onClick={() => setPreviewSide("front")}
          >
            앞면
          </button>
          <button
            className={`border px-3 py-1 ${previewSide === "back" ? "bg-slate-900 text-white" : ""}`}
            onClick={() => setPreviewSide("back")}
          >
            뒷면
          </button>
        </div>
        <button
          className="flex h-10 items-center gap-1 rounded border px-4 hover:bg-slate-100"
          onClick={() => setPreview(false)}
        >
          닫기 <X size={20} />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-slate-100 p-8">
        <svg
          viewBox={`0 0 ${design.widthMm} ${design.heightMm}`}
          style={{
            width:
              design.widthMm *
              Math.min(
                700 / design.widthMm,
                Math.max(200, window.innerHeight - 210) / design.heightMm
              ),
            height:
              design.heightMm *
              Math.min(
                700 / design.widthMm,
                Math.max(200, window.innerHeight - 210) / design.heightMm
              ),
          }}
          className="bg-white shadow-xl"
        >
          <rect width="100%" height="100%" fill={design.background} />
          {design.backgroundImage && (
            <image
              href={design.backgroundImage}
              width="100%"
              height="100%"
              preserveAspectRatio="xMidYMid slice"
            />
          )}
          {design[previewSide].map((layer) => (
            <LayerGraphic key={layer.id} layer={layer} />
          ))}
        </svg>
      </div>
      <div className="flex items-center justify-end gap-3 border-t p-4">
        <p className="mr-auto text-xs text-slate-500">
          화면과 실제 인쇄 색상은 다를 수 있습니다. 문구·안전영역·해상도를
          확인하세요.
        </p>
        <button className="rounded border px-4 py-2" onClick={exportSvg}>
          시안 SVG 다운로드
        </button>
        <button className="rounded border px-4 py-2" onClick={printProof}>
          시안출력
        </button>
        {mode === "designer" ? (
          <button
            className="rounded bg-slate-900 px-4 py-2 text-white"
            onClick={exportJson}
          >
            편집 JSON 다운로드
          </button>
        ) : (
          <span className="text-xs text-amber-800">
            주문 파일 전송은 아직 연결되지 않았습니다.
          </span>
        )}
      </div>
    </div>
  )
}
