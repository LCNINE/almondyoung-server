import { FRAME_LIBRARY } from "../../../lib/art-library"
import { ViewColumns } from "../view-columns"
import type { AlmondEditor } from "../../../hooks/use-almond-editor"

export function FramePanel({
  editor,
  frameCategory,
  setFrameCategory,
  frameColumns,
  setFrameColumns,
}: {
  editor: AlmondEditor
  frameCategory: string
  setFrameCategory: (value: string) => void
  frameColumns: 1 | 2
  setFrameColumns: (value: 1 | 2) => void
}) {
  const { selected, patch, add, removeSelected } = editor
  return (
    <>
      <button
        className="mb-2 w-full border py-2 text-sm hover:bg-slate-50"
        onClick={() =>
          add("frame", {
            frameShape: "rect",
            fill: "#e7e7e7",
            name: "사진 프레임",
          })
        }
      >
        프레임 추가
      </button>
      {selected?.type === "frame" && (
        <button
          className="mb-2 w-full border py-2 text-sm hover:bg-slate-50"
          onClick={() =>
            selected.image
              ? patch(selected.id, {
                  type: "image",
                  frameShape: undefined,
                })
              : removeSelected()
          }
        >
          마스크 제거
        </button>
      )}
      <div className="mb-4 flex items-center gap-2 border-b pb-4">
        <select
          aria-label="모양틀 분류"
          className="min-w-0 flex-1 border p-1 text-sm"
          value={frameCategory}
          onChange={(event) => setFrameCategory(event.target.value)}
        >
          {Object.keys(FRAME_LIBRARY).map((category) => (
            <option key={category}>{category}</option>
          ))}
        </select>
        <ViewColumns
          kind="모양틀"
          value={frameColumns}
          onChange={setFrameColumns}
        />
      </div>
      <div
        className={`grid gap-2 ${frameColumns === 1 ? "grid-cols-1" : "grid-cols-2"}`}
      >
        {FRAME_LIBRARY[frameCategory].map(([shape, label, path]) => (
          <button
            key={shape}
            title={label}
            aria-label={`${label} 모양틀 추가`}
            className="flex h-[122px] items-center justify-center bg-[#f5f5f5] hover:outline hover:outline-2 hover:outline-[#5e9bd9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5e9bd9]"
            onClick={() =>
              add("frame", {
                frameShape: shape,
                fill: "#e7e7e7",
                name: `${label} 모양틀`,
              })
            }
          >
            <svg
              viewBox="0 0 100 100"
              className="h-[100px] w-[100px]"
              aria-hidden="true"
            >
              <path d={path} fill="#080808" />
            </svg>
          </button>
        ))}
      </div>
    </>
  )
}
