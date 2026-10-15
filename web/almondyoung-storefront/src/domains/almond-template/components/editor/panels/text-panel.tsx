import type { AlmondEditor } from "../../../hooks/use-almond-editor"
import { usePropertyPanel } from "../../../hooks/use-property-panel"
import { ObjectProperties } from "../object-properties"

export function TextPanel({ editor }: { editor: AlmondEditor }) {
  const { setTextDialog, selected } = editor
  const panel = usePropertyPanel(editor)
  return (
    <>
      <button
        className="w-full border py-2 text-sm hover:bg-slate-50"
        onClick={() => setTextDialog("")}
      >
        + 텍스트 추가
      </button>
      {selected?.type === "text" && (
        <ObjectProperties
          editor={editor}
          panel={panel}
          selected={selected}
          inline
        />
      )}
    </>
  )
}
