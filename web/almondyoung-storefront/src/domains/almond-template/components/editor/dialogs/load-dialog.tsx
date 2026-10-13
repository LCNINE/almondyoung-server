import { Trash2, X } from "lucide-react"
import { SavedThumbnail } from "../../saved-thumbnail"
import { DATE_FORMATS, formatDate } from "@/lib/utils/format-date"
import type { AlmondEditor } from "../../../hooks/use-almond-editor"

export function LoadDialog({ editor }: { editor: AlmondEditor }) {
  const {
    mode,
    inputRef,
    setLoadDialog,
    savedItems,
    loadNamed,
    deleteNamed,
    togglePublished,
    storagePending,
  } = editor
  const designer = mode === "designer"
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={designer ? "저장 시안 불러오기" : "내 디자인 불러오기"}
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/40"
    >
      <div className="w-[560px] max-w-[95vw] bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">
            {designer ? "저장 시안 불러오기" : "내 디자인 불러오기"}
          </h2>
          <button
            aria-label="불러오기 닫기"
            className="-mr-2 flex size-10 items-center justify-center rounded hover:bg-slate-100"
            onClick={() => setLoadDialog(false)}
          >
            <X size={24} />
          </button>
        </div>
        <div className="max-h-[55vh] space-y-2 overflow-y-auto">
          {savedItems.length ? (
            savedItems.map((item) => (
              <div key={item.id} className="flex items-center gap-3 border p-3">
                {!designer && (
                  <SavedThumbnail id={item.id} version={item.updatedAt} />
                )}
                <button
                  className="min-w-0 flex-1 text-left"
                  disabled={storagePending}
                  onClick={() => loadNamed(item)}
                >
                  <strong className="block truncate text-sm">
                    {item.title}
                  </strong>
                  <span className="text-xs text-slate-500">
                    {item.size} ·{" "}
                    {formatDate(item.updatedAt, DATE_FORMATS.KO_DOT_TIME)}
                  </span>
                </button>
                {designer && (
                  <button
                    className="border px-2 py-1 text-xs disabled:opacity-50"
                    disabled={storagePending}
                    onClick={() => togglePublished(item)}
                  >
                    {item.status === "published"
                      ? "게시 중 · 내리기"
                      : "게시하기"}
                  </button>
                )}
                <button
                  aria-label={`${item.title} 삭제`}
                  disabled={storagePending}
                  className="text-red-600"
                  onClick={() => deleteNamed(item)}
                >
                  <Trash2 size={17} />
                </button>
              </div>
            ))
          ) : (
            <p className="py-8 text-center text-sm text-slate-500">
              {storagePending
                ? "불러오는 중…"
                : designer
                  ? "저장된 시안이 없습니다."
                  : "보관함이 비어 있습니다. 오른쪽 위 저장 버튼으로 작업 중인 디자인을 저장해 보세요."}
            </p>
          )}
        </div>
        {designer && (
          <button
            className="mt-4 w-full border py-2 text-sm"
            onClick={() => inputRef.current?.click()}
          >
            JSON 파일 불러오기
          </button>
        )}
      </div>
    </div>
  )
}
