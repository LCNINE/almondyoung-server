import { INDUSTRIES, PURPOSES } from "../../../lib/gallery-filter"
import { Backdrop, LayerGraphic } from "../../graphic"
import type { AlmondEditor } from "../../../hooks/use-almond-editor"
import { sideBackground } from "../../../lib/document"

export function SaveDialog({ editor }: { editor: AlmondEditor }) {
  const {
    mode,
    design,
    setSaveDialog,
    saveName,
    setSaveName,
    saveNamed,
    storagePending,
    exportJson,
    change,
  } = editor
  const designer = mode === "designer"
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={designer ? "시안 저장" : "내 디자인 저장"}
      className="absolute inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/40 p-4 md:items-center"
    >
      <div className="w-[480px] max-w-[95vw] bg-white p-5 shadow-xl">
        <h2 className="mb-3 text-lg font-bold">
          {designer ? "시안 저장" : "내 디자인 저장"}
        </h2>
        <div className="mb-4 flex h-44 items-center justify-center bg-slate-100">
          <svg
            viewBox={`0 0 ${design.widthMm} ${design.heightMm}`}
            className="h-[95%] max-w-[95%] bg-white shadow"
          >
            <Backdrop value={sideBackground(design, "front")} />
            {design.front
              .filter((layer) => layer.visible !== false)
              .map((layer) => (
                <LayerGraphic key={layer.id} layer={layer} />
              ))}
          </svg>
        </div>
        <label className="block text-sm">
          {designer ? "템플릿명" : "디자인 이름"}
          <input
            autoFocus
            aria-label={designer ? "템플릿명" : "디자인 이름"}
            maxLength={50}
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) saveNamed()
            }}
            className="mt-1 w-full border p-2"
          />
        </label>
        {designer && (
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            {(
              [
                ["industry", "업종", INDUSTRIES],
                ["purpose", "용도", PURPOSES],
              ] as const
            ).map(([field, label, options]) => (
              <label key={field} className="block">
                {label}
                <select
                  aria-label={label}
                  value={design[field] ?? options[0]}
                  onChange={(e) =>
                    change({ ...design, [field]: e.target.value })
                  }
                  className="mt-1 w-full border p-2"
                >
                  {options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        )}
        <p className="mt-2 text-xs text-slate-500">
          {designer
            ? "새 시안으로 저장됩니다. 같은 상품·크기에 같은 이름이 있으면 덮어쓸지 묻습니다. 게시는 불러오기 목록에서 합니다."
            : "내 디자인 보관함에 저장됩니다(최대 50개). 같은 상품·크기에서만 다시 불러올 수 있고, 같은 이름이 있으면 덮어쓸지 묻습니다."}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          {designer && (
            <button className="border px-3 py-2" onClick={exportJson}>
              JSON 받기
            </button>
          )}
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
