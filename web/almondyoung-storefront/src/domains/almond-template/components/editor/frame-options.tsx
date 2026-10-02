import { FRAME_LIBRARY } from "../../lib/art-library"
import type { Layer } from "../../lib/document"
import type { AlmondEditor } from "../../hooks/use-almond-editor"
import type { RefObject } from "react"
import type { PropertyPanelState } from "../../hooks/use-property-panel"
import { imageSrc } from "../../lib/image-ref"

export function FrameOptions({
  editor,
  panel,
  selected,
  selectedImageInputRef,
}: {
  editor: AlmondEditor
  panel: PropertyPanelState
  selected: Layer
  selectedImageInputRef: RefObject<HTMLInputElement>
}) {
  const { setMessage, patch, editable, imageFile, applyImageFilter } = editor
  const { brightnessOpen, setBrightnessOpen, brightness, setBrightness } = panel
  return (
    <>
      {selected.type === "frame" && (
        <>
          <label className="block">
            모양
            <select
              className="mt-1 w-full border p-2"
              value={selected.frameShape ?? "rect"}
              disabled={!editable}
              onChange={(e) =>
                patch(selected.id, {
                  frameShape: e.target.value as Layer["frameShape"],
                })
              }
            >
              <option value="rect">사각형</option>
              <option value="ellipse">원형</option>
              <option value="star">별</option>
              <option value="heart">하트</option>
              {Object.entries(FRAME_LIBRARY).map(([category, items]) => (
                <optgroup key={category} label={category}>
                  {items.map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <button
            className="w-full border p-2"
            onClick={() => selectedImageInputRef.current?.click()}
          >
            프레임에 사진 넣기
          </button>
          <input
            ref={selectedImageInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void imageFile(file, "frame")
              e.target.value = ""
            }}
          />
        </>
      )}
      {selected.type === "frame" && selected.image && (
        <div className="space-y-2 border-t pt-3">
          <p className="font-semibold">자르기</p>
          {(
            [
              ["imageScale", "확대", 1, 3, 0.1],
              ["imageOffsetX", "가로 위치", 0, 1, 0.05],
              ["imageOffsetY", "세로 위치", 0, 1, 0.05],
            ] as const
          ).map(([field, label, min, max, step]) => (
            <label key={field} className="block">
              {label}
              <input
                type="range"
                min={min}
                max={max}
                step={step}
                className="w-full"
                value={selected[field] ?? (field === "imageScale" ? 1 : 0.5)}
                disabled={!editable}
                onChange={(e) =>
                  patch(selected.id, {
                    [field]: Number(e.target.value),
                  })
                }
              />
            </label>
          ))}
        </div>
      )}
      {selected.type === "frame" && selected.image && (
        <div className="border-t pt-3">
          <p className="mb-2 font-semibold">필터</p>
          <div className="grid grid-cols-3 gap-1">
            {(
              [
                ["No filter", "none"],
                ["Grayscale", "grayscale"],
                ["Emboss", "emboss"],
                ["BoxBlur", "boxblur"],
                ["Brightness", "brightness"],
                ["Sepia", "sepia"],
              ] as const
            ).map(([label, filter]) => (
              <button
                key={label}
                type="button"
                aria-label={`${label} 필터`}
                disabled={!editable}
                aria-pressed={(selected.imageFilter ?? "none") === filter}
                className={`border px-1 py-2 text-[11px] hover:bg-slate-50 ${(selected.imageFilter ?? "none") === filter ? "border-[#333] bg-[#eee]" : ""}`}
                onClick={() => {
                  if (filter === "none") {
                    if (selected.originalImage)
                      patch(selected.id, {
                        image: selected.originalImage,
                        originalImage: undefined,
                        imageFilter: undefined,
                      })
                    setBrightnessOpen(false)
                    setMessage("원본 사진으로 복원했습니다.")
                  } else if (filter === "brightness") {
                    setBrightnessOpen(true)
                  } else {
                    setBrightnessOpen(false)
                    void applyImageFilter(filter)
                  }
                }}
              >
                <img
                  src={imageSrc(selected.originalImage ?? selected.image ?? "")}
                  alt=""
                  className="mb-1 h-[50px] w-full object-cover"
                  style={{
                    filter: {
                      none: "none",
                      grayscale: "grayscale(1)",
                      emboss: "grayscale(1) contrast(2)",
                      boxblur: "blur(2px)",
                      brightness: "brightness(1.3)",
                      sepia: "sepia(1)",
                    }[filter],
                  }}
                />
                {label}
              </button>
            ))}
          </div>
          {brightnessOpen && (
            <div className="mt-2 border p-2 text-xs">
              <label htmlFor="image-brightness">
                Brightness · {brightness}
              </label>
              <div className="flex items-center gap-2">
                <span>어둡게</span>
                <input
                  id="image-brightness"
                  aria-label="밝기 조절"
                  type="range"
                  min="0"
                  max="100"
                  value={brightness}
                  onChange={(event) =>
                    setBrightness(Number(event.target.value))
                  }
                  className="min-w-0 flex-1"
                />
                <span>밝게</span>
              </div>
              <button
                type="button"
                className="mt-2 w-full border py-1"
                onClick={() => void applyImageFilter("brightness", brightness)}
              >
                적용
              </button>
            </div>
          )}
        </div>
      )}
    </>
  )
}
