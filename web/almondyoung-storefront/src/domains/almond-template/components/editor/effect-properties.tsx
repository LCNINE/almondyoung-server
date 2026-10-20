import type { AlmondEditor } from "../../hooks/use-almond-editor"
import type { Layer } from "../../lib/document"
import { EFFECT_LAYERS } from "../../lib/effect-layer"
import {
  AlignOrderSection,
  PropHeader,
  PropSection,
  PropSlider,
  Toggle,
  SizeSection,
  OpacitySection,
} from "./prop-sections"
import { PrintColorPicker } from "../color-picker"

export function EffectProperties({
  editor,
  selected,
}: {
  editor: AlmondEditor
  selected: Layer
}) {
  return (
    <aside aria-label="효과 속성" className="w-full bg-white text-sm">
      <PropHeader title={selected.name} />
      <PropSection className="py-4">
        <p className="text-[13px] leading-5 text-[#70777F]">
          캔버스에서 이동하거나 모서리를 끌어 크기를 조절하세요. 레이어 순서에
          따라 글자 위·아래로 배치할 수 있습니다.
        </p>
      </PropSection>
      <AlignOrderSection editor={editor} layer={selected} />
      <SizeSection editor={editor} layer={selected} />
      <OpacitySection
        value={selected.opacity}
        disabled={!editor.editable}
        onValue={(opacity) => editor.patch(selected.id, { opacity })}
      />
      <PropSection className="py-4">
        <label className="block text-sm">
          효과 종류
          <select
            aria-label="효과 종류"
            className="mt-2 w-full rounded-md border p-2"
            value={selected.effectKind}
            disabled={!editor.editable}
            onChange={(event) => {
              const item = EFFECT_LAYERS.find(
                ([key]) => key === event.target.value
              )
              if (item)
                editor.patch(selected.id, {
                  effectKind: item[0],
                  name: item[1],
                  fill: item[3],
                })
            }}
          >
            {EFFECT_LAYERS.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </PropSection>
      {["glitter", "stardust", "bokeh"].includes(selected.effectKind ?? "") && (
        <PropSection className="py-4">
          <PropSlider
            label="입자 밀도"
            min={0}
            max={100}
            value={selected.effectDensity ?? 45}
            disabled={!editor.editable}
            onValue={(effectDensity) =>
              editor.patch(selected.id, { effectDensity })
            }
          />
        </PropSection>
      )}
      {[
        "glow",
        "halo",
        "glitter",
        "pearl",
        "lightLeak",
        "caustics",
        "bokeh",
        "stardust",
        "reflection",
        "ripple",
      ].includes(selected.effectKind ?? "") && (
        <PropSection className="py-4">
          <PrintColorPicker
            label="효과 색상"
            value={selected.fill}
            disabled={!editor.editable}
            onApply={(fill) => editor.patch(selected.id, { fill })}
          />
        </PropSection>
      )}
      {editor.mode === "designer" && (
        <PropSection className="py-4">
          <Toggle
            label="고객 편집 허용"
            checked={selected.editable !== false}
            onChange={(editable) => editor.patch(selected.id, { editable })}
          />
          <Toggle
            label="위치 잠금"
            checked={!!selected.locked}
            onChange={(locked) => editor.patch(selected.id, { locked })}
          />
        </PropSection>
      )}
    </aside>
  )
}
