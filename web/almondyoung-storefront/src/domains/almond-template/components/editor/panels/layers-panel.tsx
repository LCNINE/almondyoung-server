import { useState } from "react"
import { Eye, Lock, LockOpen, EyeOff } from "lucide-react"
import { LayerGraphic } from "../../graphic"
import type { AlmondEditor } from "../../../hooks/use-almond-editor"

export function LayersPanel({ editor }: { editor: AlmondEditor }) {
  const { design, change, side, selectedId, setSelectedId, layers, patch } =
    editor
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const rename = (id: string, current: string, value: string) => {
    setRenamingId(null)
    const name = value.trim().slice(0, 100)
    if (name && name !== current) patch(id, { name })
  }
  return (
    <div className="border-t">
      {[...layers].reverse().map((layer) => (
        <div
          key={layer.id}
          draggable={renamingId !== layer.id}
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "move"
            event.dataTransfer.setData("application/x-almond-layer", layer.id)
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            const sourceId = event.dataTransfer.getData(
              "application/x-almond-layer"
            )
            const sourceIndex = layers.findIndex((item) => item.id === sourceId)
            const targetIndex = layers.findIndex((item) => item.id === layer.id)
            if (
              sourceIndex < 0 ||
              targetIndex < 0 ||
              sourceIndex === targetIndex
            )
              return
            const next = [...layers]
            const [moved] = next.splice(sourceIndex, 1)
            next.splice(targetIndex, 0, moved)
            change({ ...design, [side]: next })
            setSelectedId(sourceId)
          }}
          title="끌어서 레이어 순서 변경"
          className={`flex h-[49px] w-full items-center gap-1 border-b px-1 text-left text-xs ${selectedId === layer.id ? "bg-[#d4d4d4]" : "hover:bg-[#eee]"}`}
        >
          <div
            role="button"
            tabIndex={0}
            aria-label={`레이어 ${layer.name} 선택`}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
            onClick={() => setSelectedId(layer.id)}
            onKeyDown={(event) => {
              if (event.target === event.currentTarget && event.key === "Enter")
                setSelectedId(layer.id)
            }}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden bg-[#f5f5f5]">
              <svg viewBox="0 0 40 40" className="h-7 w-7" aria-hidden="true">
                <LayerGraphic
                  layer={{
                    ...layer,
                    id: `thumb-${layer.id}`,
                    x: 2,
                    y: 2,
                    width: 36,
                    height: 36,
                    fontSize: 9,
                  }}
                />
              </svg>
            </span>
            {renamingId === layer.id ? (
              <input
                autoFocus
                aria-label="레이어 이름"
                defaultValue={layer.name}
                maxLength={100}
                onFocus={(event) => event.currentTarget.select()}
                onBlur={(event) =>
                  rename(layer.id, layer.name, event.currentTarget.value)
                }
                onKeyDown={(event) => {
                  if (event.key === "Escape")
                    event.currentTarget.value = layer.name
                  if (event.key === "Enter" || event.key === "Escape")
                    event.currentTarget.blur()
                }}
                className="min-w-0 flex-1 rounded border bg-white px-1 py-0.5 not-italic"
              />
            ) : (
              <span
                className="truncate italic"
                title="더블클릭해서 이름 바꾸기"
                onDoubleClick={() => {
                  if (!layer.locked) setRenamingId(layer.id)
                }}
              >
                {layer.name}
              </span>
            )}
          </div>
          <button
            title={layer.visible === false ? "표시" : "숨기기"}
            aria-label={`${layer.name} ${layer.visible === false ? "표시" : "숨기기"}`}
            onClick={() =>
              patch(layer.id, { visible: layer.visible === false })
            }
          >
            {layer.visible === false ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
          <button
            title={layer.locked ? "잠금 해제" : "잠그기"}
            aria-label={`${layer.name} ${layer.locked ? "잠금 해제" : "잠그기"}`}
            onClick={() => patch(layer.id, { locked: !layer.locked })}
          >
            {layer.locked ? <Lock size={15} /> : <LockOpen size={15} />}
          </button>
        </div>
      ))}
      <div className="border-b py-2 text-center text-xs text-slate-600 italic">
        Background
      </div>
    </div>
  )
}
