import type { AlmondEditor } from "../../hooks/use-almond-editor"
import type { Layer } from "../../lib/document"
import { PHOTO_EFFECTS } from "../../lib/photo-effects"
import { MOTION_MASKS } from "../../lib/effect-layer"
import { PropSection, PropSlider } from "./prop-sections"

export function PhotoEffectControls({
  editor,
  selected,
}: {
  editor: AlmondEditor
  selected: Layer
}) {
  const { patch, editable } = editor
  const mask = selected.imageMotionMask ?? {
    shape: "full",
    x: 0,
    y: 30,
    width: 100,
    height: 35,
  }
  return (
    <>
      <PropSection className="space-y-3 py-4">
        <label className="block text-[13px] text-[#59616d]">
          번짐 적용 영역
          <select
            aria-label="번짐 적용 영역"
            value={mask.shape}
            disabled={!editable}
            className="mt-2 w-full rounded-md border border-[#dce0e5] bg-white p-2 text-sm"
            onChange={(event) =>
              patch(selected.id, {
                imageMotionMask: {
                  ...mask,
                  shape: event.target.value as typeof mask.shape,
                },
              })
            }
          >
            {MOTION_MASKS.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {mask.shape !== "full" && (
          <details open>
            <summary className="cursor-pointer py-2 text-sm">
              영역 위치·크기
            </summary>
            <div className="space-y-3">
              {(
                [
                  ["x", "가로 위치"],
                  ["y", "세로 위치"],
                  ["width", "영역 너비"],
                  ["height", "영역 높이"],
                ] as const
              ).map(([key, label]) => (
                <PropSlider
                  key={key}
                  label={`${label} %`}
                  min={key === "x" || key === "y" ? 0 : 1}
                  max={100}
                  value={mask[key]}
                  disabled={!editable}
                  onValue={(value) =>
                    patch(selected.id, {
                      imageMotionMask: { ...mask, [key]: value },
                    })
                  }
                />
              ))}
            </div>
          </details>
        )}
      </PropSection>
      <PropSection className="py-4">
        <details>
          <summary className="cursor-pointer text-[15px] font-medium text-[#20232A]">
            사진 분위기 효과
          </summary>
          <p className="my-3 text-xs leading-5 text-[#70777F]">
            농도를 올려 적용하고 0으로 내려 해제하세요. 여러 효과를 함께 사용할
            수 있습니다.
          </p>
          <div className="space-y-4">
            {PHOTO_EFFECTS.map(([key, label]) => (
              <PropSlider
                key={key}
                label={label}
                min={0}
                max={100}
                value={selected.photoEffects?.[key] ?? 0}
                disabled={!editable}
                onValue={(value) =>
                  patch(selected.id, {
                    photoEffects: { ...selected.photoEffects, [key]: value },
                  })
                }
              />
            ))}
          </div>
        </details>
      </PropSection>
    </>
  )
}
