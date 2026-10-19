import { useRef, useState, type DragEvent, type MouseEvent } from "react"
import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Folder,
  Lock,
  LockOpen,
} from "lucide-react"
import { LayerGraphic } from "../../graphic"
import type { AlmondEditor } from "../../../hooks/use-almond-editor"
import type { Layer } from "../../../lib/document"

const DRAG_TYPE = "application/x-almond-layer"

type Row =
  | { kind: "layer"; layer: Layer; nested: boolean }
  | { kind: "group"; groupId: string; name: string; members: Layer[] }

// 위에 그려지는 레이어가 위에 오게 뒤집고, 붙어 있는 같은 그룹은 머리줄 하나 아래로 모은다
function toRows(layers: Layer[], collapsed: ReadonlySet<string>): Row[] {
  const rows: Row[] = []
  const top = [...layers].reverse()
  for (let i = 0; i < top.length; ) {
    const groupId = top[i].groupId
    let end = i + 1
    while (groupId && end < top.length && top[end].groupId === groupId) end++
    if (!groupId) {
      rows.push({ kind: "layer", layer: top[i], nested: false })
    } else {
      const members = top.slice(i, end)
      rows.push({
        kind: "group",
        groupId,
        name: members[0].groupName ?? "그룹",
        members,
      })
      if (!collapsed.has(groupId))
        for (const layer of members)
          rows.push({ kind: "layer", layer, nested: true })
    }
    i = end
  }
  return rows
}

export function LayersPanel({ editor }: { editor: AlmondEditor }) {
  const {
    design,
    change,
    side,
    selectedId,
    groupIds,
    selectLayers,
    layers,
    patch,
    mergeGroup,
    splitGroup,
    mergedGroup,
  } = editor
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const anchor = useRef<string | null>(null)
  const selection = groupIds.length ? groupIds : selectedId ? [selectedId] : []
  const rows = toRows(layers, collapsed)
  const order = rows.flatMap((row) =>
    row.kind === "layer" ? [row.layer.id] : []
  )

  const patchMany = (ids: string[], value: Partial<Layer>) =>
    change({
      ...design,
      [side]: layers.map((layer) =>
        ids.includes(layer.id) ? { ...layer, ...value } : layer
      ),
    })

  // Shift 는 범위, Cmd·Ctrl 은 하나씩 더하거나 뺀다
  const pick = (event: MouseEvent, id: string) => {
    if (event.shiftKey && anchor.current && order.includes(anchor.current)) {
      const [a, b] = [order.indexOf(anchor.current), order.indexOf(id)].sort(
        (x, y) => x - y
      )
      return selectLayers(order.slice(a, b + 1))
    }
    anchor.current = id
    if (event.metaKey || event.ctrlKey)
      return selectLayers(
        selection.includes(id)
          ? selection.filter((item) => item !== id)
          : [...selection, id]
      )
    selectLayers([id])
  }

  // 끈 묶음을 놓은 줄 자리로 옮긴다. 그룹 안 줄에 놓으면 그 그룹에 들어가고, 밖에 놓으면 빠진다
  // 그룹 머리줄을 끌면 그룹째 옮기고 그룹은 그대로 둔다
  const drop = (event: DragEvent, targetId: string) => {
    event.preventDefault()
    const data = event.dataTransfer.getData(DRAG_TYPE)
    if (!data) return
    const { ids, keepGroup } = JSON.parse(data) as {
      ids: string[]
      keepGroup: boolean
    }
    if (!ids.length || ids.includes(targetId)) return
    const target = layers.find((layer) => layer.id === targetId)
    if (!target) return
    const moving = layers
      .filter((layer) => ids.includes(layer.id))
      .map((layer) =>
        keepGroup
          ? layer
          : {
              ...layer,
              groupId: target.groupId,
              groupName: target.groupName,
            }
      )
    const rest = layers.filter((layer) => !ids.includes(layer.id))
    const below =
      layers.findIndex((layer) => ids.includes(layer.id)) <
      layers.indexOf(target)
    const at = rest.indexOf(target) + (below ? 1 : 0)
    change({
      ...design,
      [side]: [...rest.slice(0, at), ...moving, ...rest.slice(at)],
    })
    selectLayers(ids)
  }
  const startDrag = (event: DragEvent, ids: string[], keepGroup = false) => {
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ ids, keepGroup }))
  }

  const rename = (ids: string[], current: string, value: string) => {
    setRenamingId(null)
    const name = value.trim().slice(0, ids.length > 1 ? 40 : 100)
    if (!name || name === current) return
    if (ids.length > 1) patchMany(ids, { groupName: name })
    else patch(ids[0], { name })
  }
  const nameInput = (ids: string[], current: string) => (
    <input
      autoFocus
      aria-label="이름"
      defaultValue={current}
      maxLength={ids.length > 1 ? 40 : 100}
      onFocus={(event) => event.currentTarget.select()}
      onClick={(event) => event.stopPropagation()}
      onBlur={(event) => rename(ids, current, event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Escape") event.currentTarget.value = current
        if (event.key === "Enter" || event.key === "Escape")
          event.currentTarget.blur()
      }}
      className="min-w-0 flex-1 rounded border bg-white px-1 py-0.5"
    />
  )
  const toggles = (members: Layer[], label: string) => {
    const hidden = members.every((layer) => layer.visible === false)
    const locked = members.every((layer) => layer.locked)
    const ids = members.map((layer) => layer.id)
    return (
      <>
        <button
          title={hidden ? "표시" : "숨기기"}
          aria-label={`${label} ${hidden ? "표시" : "숨기기"}`}
          onClick={() => patchMany(ids, { visible: hidden })}
        >
          {hidden ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
        <button
          title={locked ? "잠금 해제" : "잠그기"}
          aria-label={`${label} ${locked ? "잠금 해제" : "잠그기"}`}
          onClick={() => patchMany(ids, { locked: !locked })}
        >
          {locked ? <Lock size={15} /> : <LockOpen size={15} />}
        </button>
      </>
    )
  }

  return (
    <div className="border-t">
      {selection.length > 1 && (
        <div className="flex items-center gap-2 border-b bg-slate-50 px-2 py-2 text-xs">
          <span className="flex-1 text-slate-600">
            {selection.length}개 선택
          </span>
          <button
            className="border bg-white px-2 py-1 hover:bg-slate-100"
            onClick={mergedGroup ? splitGroup : mergeGroup}
          >
            {mergedGroup ? "그룹 풀기" : "그룹으로 묶기"}
          </button>
        </div>
      )}
      {rows.map((row) => {
        if (row.kind === "group") {
          const ids = row.members.map((layer) => layer.id)
          const open = !collapsed.has(row.groupId)
          const picked = ids.every((id) => selection.includes(id))
          return (
            <div
              key={`group-${row.groupId}`}
              draggable={renamingId !== row.groupId}
              onDragStart={(event) => startDrag(event, ids, true)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => drop(event, ids[0])}
              className={`flex h-9 w-full items-center gap-1 border-b px-1 text-xs ${picked ? "bg-[#d4d4d4]" : "bg-[#f7f7f7] hover:bg-[#eee]"}`}
            >
              <button
                aria-label={open ? "그룹 접기" : "그룹 펼치기"}
                onClick={() =>
                  setCollapsed((current) => {
                    const next = new Set(current)
                    if (open) next.add(row.groupId)
                    else next.delete(row.groupId)
                    return next
                  })
                }
              >
                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              <div
                role="button"
                tabIndex={0}
                aria-label={`그룹 ${row.name} 선택`}
                className="flex min-w-0 flex-1 items-center gap-1.5"
                onClick={() => {
                  anchor.current = null
                  selectLayers(ids)
                }}
              >
                <Folder size={14} className="shrink-0 text-slate-500" />
                {renamingId === row.groupId ? (
                  nameInput(ids, row.name)
                ) : (
                  <span
                    className="truncate font-medium"
                    title="더블클릭해서 이름 바꾸기"
                    onDoubleClick={() => setRenamingId(row.groupId)}
                  >
                    {row.name}
                  </span>
                )}
                <span className="shrink-0 text-slate-400">{ids.length}</span>
              </div>
              {toggles(row.members, `그룹 ${row.name}`)}
            </div>
          )
        }
        const { layer, nested } = row
        const dragIds = selection.includes(layer.id) ? selection : [layer.id]
        return (
          <div
            key={layer.id}
            draggable={renamingId !== layer.id}
            onDragStart={(event) => startDrag(event, dragIds)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => drop(event, layer.id)}
            title="끌어서 순서 변경 · Shift/⌘ 로 여러 개 선택"
            className={`flex h-[49px] w-full items-center gap-1 border-b px-1 text-left text-xs ${nested ? "pl-6" : ""} ${selection.includes(layer.id) ? "bg-[#d4d4d4]" : "hover:bg-[#eee]"}`}
          >
            <div
              role="button"
              tabIndex={0}
              aria-label={`레이어 ${layer.name} 선택`}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
              onClick={(event) => pick(event, layer.id)}
              onKeyDown={(event) => {
                if (
                  event.target === event.currentTarget &&
                  event.key === "Enter"
                )
                  selectLayers([layer.id])
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
                nameInput([layer.id], layer.name)
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
            {toggles([layer], layer.name)}
          </div>
        )
      })}
      <div className="border-b py-2 text-center text-xs text-slate-600 italic">
        Background
      </div>
    </div>
  )
}
