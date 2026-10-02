import { X } from "lucide-react"
import type { AlmondEditor } from "../../../hooks/use-almond-editor"

export function TextDialog({
  editor,
  textDialog,
}: {
  editor: AlmondEditor
  textDialog: string
}) {
  const { setTextDialog, add } = editor
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="텍스트 추가"
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/40"
      onClick={() => setTextDialog(null)}
    >
      <div
        className="w-[740px] max-w-[calc(100vw-40px)] bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between border-b pb-3">
          <h2 className="text-sm font-semibold">텍스트 추가</h2>
          <button
            type="button"
            aria-label="텍스트 추가 닫기"
            onClick={() => setTextDialog(null)}
            className="-mr-2 flex size-10 items-center justify-center rounded text-slate-600 hover:bg-slate-100"
          >
            <X size={24} />
          </button>
        </div>
        <textarea
          autoFocus
          aria-label="추가할 문구"
          className="h-32 w-full resize-none border bg-[#f4f4f4] p-3 text-xl"
          placeholder="텍스트를 입력하세요"
          value={textDialog}
          onChange={(e) => setTextDialog(e.target.value)}
          maxLength={500}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            className="bg-slate-900 px-4 py-2 text-white"
            onClick={() => {
              if (textDialog.trim()) add("text", { text: textDialog.trim() })
              setTextDialog(null)
            }}
          >
            확인
          </button>
        </div>
      </div>
    </div>
  )
}
