import { LayerGraphic } from "../../graphic"
import type { AlmondEditor } from "../../../hooks/use-almond-editor"
import { imageSrc } from "../../../lib/image-ref"

export function SaveDialog({ editor }: { editor: AlmondEditor }) {
  const {
    design,
    side,
    setSaveDialog,
    saveName,
    setSaveName,
    saveNamed,
    storagePending,
    exportJson,
  } = editor
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="시안 저장"
      className="absolute inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/40 p-4 md:items-center"
    >
      <div className="w-[480px] max-w-[95vw] bg-white p-5 shadow-xl">
        <h2 className="mb-3 text-lg font-bold">시안 저장</h2>
        <div className="mb-4 flex h-44 items-center justify-center bg-slate-100">
          <svg
            viewBox={`0 0 ${design.widthMm} ${design.heightMm}`}
            className="h-[95%] max-w-[95%] bg-white shadow"
          >
            <rect width="100%" height="100%" fill={design.background} />
            {design.backgroundImage && (
              <image
                href={imageSrc(design.backgroundImage)}
                width="100%"
                height="100%"
                preserveAspectRatio="xMidYMid slice"
              />
            )}
            {design[side].map((layer) => (
              <LayerGraphic key={layer.id} layer={layer} />
            ))}
          </svg>
        </div>
        <label className="block text-sm">
          템플릿명
          <input
            aria-label="템플릿명"
            maxLength={50}
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            className="mt-1 w-full border p-2"
          />
        </label>
        <p className="mt-2 text-xs text-slate-500">
          서버에 초안으로 저장됩니다. 같은 상품·크기·이름으로 저장하면 기존
          시안을 덮어씁니다. 게시는 불러오기 목록에서 합니다.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button className="border px-3 py-2" onClick={exportJson}>
            JSON 받기
          </button>
          <button
            className="border px-3 py-2"
            onClick={() => setSaveDialog(false)}
          >
            취소
          </button>
          <button
            className="bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
            disabled={storagePending}
            onClick={saveNamed}
          >
            {storagePending ? "저장 중…" : "저장하기"}
          </button>
        </div>
      </div>
    </div>
  )
}
