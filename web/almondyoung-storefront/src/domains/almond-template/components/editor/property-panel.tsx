import { EffectProperties } from "./effect-properties"
import type { AlmondEditor } from "../../hooks/use-almond-editor"
import { usePropertyPanel } from "../../hooks/use-property-panel"
import { ImageProperties } from "./image-properties"
import { ObjectProperties } from "./object-properties"
import { GroupProperties } from "./group-properties"

// 요소를 고르면 왼쪽 메뉴 패널 자리에 그 요소의 속성이 들어온다(망고보드). 선택을 풀면 메뉴로 돌아간다
export function PropertyPanel({ editor }: { editor: AlmondEditor }) {
  const panel = usePropertyPanel(editor)
  const { selected, group } = editor
  if (group.length > 1)
    return <GroupProperties editor={editor} panel={panel} inline />
  if (!selected) return null
  if (selected.type === "effect")
    return <EffectProperties editor={editor} selected={selected} />
  return selected.type === "image" ? (
    <ImageProperties editor={editor} panel={panel} selected={selected} inline />
  ) : (
    <ObjectProperties
      editor={editor}
      panel={panel}
      selected={selected}
      inline
    />
  )
}
