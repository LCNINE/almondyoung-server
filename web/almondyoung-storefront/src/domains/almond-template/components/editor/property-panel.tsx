import type { AlmondEditor } from "../../hooks/use-almond-editor"
import { usePropertyPanel } from "../../hooks/use-property-panel"
import { ImageProperties } from "./image-properties"
import { ObjectProperties } from "./object-properties"
import { GroupProperties } from "./group-properties"

export function PropertyPanel({ editor }: { editor: AlmondEditor }) {
  const panel = usePropertyPanel(editor)
  const { selected, tool, panelOpen, group } = editor
  const inTextPanel = selected?.type === "text" && tool === "text" && panelOpen
  return (
    <>
      {selected?.type === "image" && (
        <ImageProperties editor={editor} panel={panel} selected={selected} />
      )}
      {selected && selected.type !== "image" && !inTextPanel && (
        <ObjectProperties editor={editor} panel={panel} selected={selected} />
      )}
      {group.length > 1 && <GroupProperties editor={editor} panel={panel} />}
    </>
  )
}
