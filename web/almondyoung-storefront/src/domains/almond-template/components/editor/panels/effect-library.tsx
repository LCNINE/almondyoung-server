import { useState } from "react"
import type { AlmondEditor } from "../../../hooks/use-almond-editor"
import { EFFECT_LAYERS } from "../../../lib/effect-layer"
import { EffectLayerGraphic } from "../../effect-layer"

export function EffectLibrary({ editor }: { editor: AlmondEditor }) {
  const [category, setCategory] = useState("전체")
  const size = Math.min(editor.design.widthMm, editor.design.heightMm) * 0.7
  return (
    <div>
      <p className="mb-3 text-[13px] leading-5 text-[#70777F]">
        효과를 추가한 뒤 위치·크기·회전·농도를 자유롭게 조절하세요.
      </p>
      <div className="mb-4 flex flex-wrap gap-1" aria-label="효과 분류">
        {["전체", "빛", "몽환", "질감", "유리·그림자"].map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={category === name}
            onClick={() => setCategory(name)}
            className={`rounded-full px-3 py-1.5 text-xs ${category === name ? "bg-[#333b49] text-white" : "bg-[#f1f3f5] text-[#59616d]"}`}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {EFFECT_LAYERS.filter(
          (item) => category === "전체" || item[2] === category
        ).map(([key, label, , fill]) => (
          <button
            key={key}
            type="button"
            aria-label={`${label} 효과 추가`}
            className="overflow-hidden rounded-lg border border-[#e2e5ea] text-left hover:border-[#707b8d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5e9bd9]"
            onClick={() =>
              editor.add("effect", {
                effectKind: key,
                name: label,
                fill,
                width: size,
                height: size,
                x: (editor.design.widthMm - size) / 2,
                y: (editor.design.heightMm - size) / 2,
                opacity: 0.65,
              })
            }
          >
            <svg
              viewBox="0 0 100 80"
              aria-hidden="true"
              className="h-[90px] w-full"
            >
              <rect width="100" height="80" fill="#514951" />
              <EffectLayerGraphic
                layer={{
                  id: `sample-${key}`,
                  type: "effect",
                  name: label,
                  effectKind: key,
                  x: 0,
                  y: 0,
                  width: 100,
                  height: 80,
                  fill,
                }}
              />
            </svg>
            <span className="block bg-white px-2.5 py-2 text-xs text-[#3F4250]">
              {label}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
