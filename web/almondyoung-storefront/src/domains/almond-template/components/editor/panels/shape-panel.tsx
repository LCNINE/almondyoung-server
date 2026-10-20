import { EffectLibrary } from "./effect-library"
import { Fragment, useState } from "react"
import { LayerGraphic } from "../../graphic"
import { SHAPES } from "../../../lib/art-library"
import type { Layer } from "../../../lib/document"
import { ViewColumns } from "../view-columns"
import type { AlmondEditor } from "../../../hooks/use-almond-editor"

export function ShapePanel({
  editor,
  shapeCategory,
  setShapeCategory,
  shapeColumns,
  setShapeColumns,
}: {
  editor: AlmondEditor
  shapeCategory: keyof typeof SHAPES
  setShapeCategory: (value: keyof typeof SHAPES) => void
  shapeColumns: 1 | 2
  setShapeColumns: (value: 1 | 2) => void
}) {
  const [mode, setMode] = useState<"shape" | "effect">("shape")
  const { add, design } = editor
  const side = Math.min(design.widthMm, design.heightMm) * 0.3
  // 처음 넣을 때는 정비율(정사각)로 넣는다. 선만 가로로 길게 둔다
  const square = (type: string) =>
    type === "line"
      ? {}
      : {
          x: Math.round(((design.widthMm - side) / 2) * 10) / 10,
          y: Math.round(((design.heightMm - side) / 2) * 10) / 10,
          width: Math.round(side * 10) / 10,
          height: Math.round(side * 10) / 10,
        }
  return (
    <>
      <div className="mb-4 grid grid-cols-2 rounded-lg bg-[#f1f3f5] p-1">
        {(
          [
            ["shape", "도형"],
            ["effect", "빛·질감 효과"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={mode === key}
            onClick={() => setMode(key)}
            className={`rounded-md py-2 text-sm ${mode === key ? "bg-white font-medium text-[#20232A] shadow-sm" : "text-[#70777F]"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === "effect" ? (
        <EffectLibrary editor={editor} />
      ) : (
        <>
          <div className="mb-4 flex items-center gap-2">
            <select
              aria-label="도형 분류"
              value={shapeCategory}
              onChange={(event) =>
                setShapeCategory(event.target.value as keyof typeof SHAPES)
              }
              className="min-w-0 flex-1 border p-2 text-sm"
            >
              {Object.keys(SHAPES).map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
            <ViewColumns
              kind="도형"
              value={shapeColumns}
              onChange={setShapeColumns}
            />
          </div>
          <div
            className={`grid gap-2 border-t pt-5 ${shapeColumns === 1 ? "grid-cols-1 group-data-[wide]/panel:grid-cols-2" : "grid-cols-2 group-data-[wide]/panel:grid-cols-4"}`}
          >
            {SHAPES[shapeCategory].map(([id, label, type], index) => (
              <Fragment key={id}>
                {index === 4 && shapeCategory === "기본도형" && (
                  <div className={`col-span-full border-t pt-2`} />
                )}
                <button
                  aria-label={`${label} 추가`}
                  title={label}
                  className="flex h-[110px] items-center justify-center bg-[#f5f5f5] hover:outline hover:outline-2 hover:outline-[#5e9bd9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5e9bd9]"
                  onClick={() =>
                    add(type as Layer["type"], {
                      ...square(type),
                      name: label,
                      shapeVariant: id === type ? undefined : id,
                      fill:
                        index < 4 && shapeCategory === "기본도형"
                          ? "#ffffff"
                          : "#111111",
                      stroke:
                        index < 4 && shapeCategory === "기본도형"
                          ? "#bcbcbc"
                          : "none",
                      strokeWidth:
                        index < 4 && shapeCategory === "기본도형" ? 1 : 0,
                    })
                  }
                >
                  <svg
                    viewBox="0 0 100 100"
                    className="h-[82px] w-[82px]"
                    aria-hidden="true"
                  >
                    <LayerGraphic
                      layer={{
                        id,
                        type: type as Layer["type"],
                        name: label,
                        x: 10,
                        y: 10,
                        width: 80,
                        height: 80,
                        fill:
                          index < 4 && shapeCategory === "기본도형"
                            ? "#ffffff"
                            : "#111111",
                        stroke:
                          index < 4 && shapeCategory === "기본도형"
                            ? "#c2c2c2"
                            : "none",
                        strokeWidth: type === "line" ? 3 : 1,
                        shapeVariant: id === type ? undefined : id,
                      }}
                    />
                  </svg>
                </button>
              </Fragment>
            ))}
          </div>
        </>
      )}
    </>
  )
}
