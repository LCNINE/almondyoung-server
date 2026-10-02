import { CLIPART } from "../../../lib/art-library"
import { CLIPART_DATA } from "../../../lib/clipart-data"
import { ViewColumns } from "../view-columns"
import type { AlmondEditor } from "../../../hooks/use-almond-editor"

export function ClipartPanel({
  editor,
  clipartCategory,
  setClipartCategory,
  clipartColumns,
  setClipartColumns,
}: {
  editor: AlmondEditor
  clipartCategory: keyof typeof CLIPART
  setClipartCategory: (value: keyof typeof CLIPART) => void
  clipartColumns: 1 | 2
  setClipartColumns: (value: 1 | 2) => void
}) {
  const { add } = editor
  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <select
          aria-label="클립아트 분류"
          value={clipartCategory}
          onChange={(event) =>
            setClipartCategory(event.target.value as keyof typeof CLIPART)
          }
          className="min-w-0 flex-1 border p-2 text-sm"
        >
          {Object.keys(CLIPART).map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
        <ViewColumns
          kind="클립아트"
          value={clipartColumns}
          onChange={setClipartColumns}
        />
      </div>
      <div
        className={`grid gap-2 border-t pt-4 ${clipartColumns === 1 ? "grid-cols-1" : "grid-cols-2"}`}
      >
        {CLIPART[clipartCategory].map(([id, label]) => (
          <button
            key={id}
            aria-label={`${label} 클립아트 추가`}
            title={label}
            onClick={() =>
              add("clipart", {
                clipartId: id,
                fill: "#111111",
                name: label,
              })
            }
            className="flex h-[104px] items-center justify-center bg-[#f5f5f5] hover:outline hover:outline-2 hover:outline-[#5e9bd9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5e9bd9]"
          >
            <img
              src={CLIPART_DATA[id]}
              alt=""
              loading="lazy"
              className="h-[82px] w-[82px] object-contain"
            />
          </button>
        ))}
      </div>
    </>
  )
}
