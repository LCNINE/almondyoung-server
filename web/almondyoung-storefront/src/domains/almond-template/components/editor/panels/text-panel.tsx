import type { AlmondEditor } from "../../../hooks/use-almond-editor"

export function TextPanel({ editor }: { editor: AlmondEditor }) {
  const { setTextDialog } = editor
  return (
    <button
      className="w-full border py-2 text-sm hover:bg-slate-50"
      onClick={() => setTextDialog("")}
    >
      + 텍스트 추가
    </button>
  )
}
