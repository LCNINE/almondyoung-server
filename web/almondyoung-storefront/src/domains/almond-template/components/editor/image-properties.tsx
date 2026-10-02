import {
  RotateCcw,
  FlipHorizontal,
  FlipVertical,
  Link,
  Unlink,
  Crop,
  ChevronDown,
  ChevronUp,
} from "lucide-react"
import type { Layer } from "../../lib/document"
import { OrderIcon } from "./order-icon"
import type { AlmondEditor } from "../../hooks/use-almond-editor"
import type { PropertyPanelState } from "../../hooks/use-property-panel"
import { imageSrc } from "../../lib/image-ref"

export function ImageProperties({
  editor,
  panel,
  selected,
}: {
  editor: AlmondEditor
  panel: PropertyPanelState
  selected: Layer
}) {
  const {
    mode,
    selectedLowDpi,
    selectedPrintWarning,
    patch,
    editable,
    setOrder,
    setGeometry,
    applyImageFilter,
  } = editor
  const {
    brightnessOpen,
    setBrightnessOpen,
    imageMoreOpen,
    setImageMoreOpen,
    imageCropOpen,
    setImageCropOpen,
    imageSizeLinked,
    setImageSizeLinked,
    brightness,
    setBrightness,
    setImageSize,
  } = panel
  return (
    <aside
      aria-label="이미지 속성"
      className="absolute top-[18%] right-5 z-20 max-h-[72%] w-[285px] overflow-y-auto border bg-white text-sm shadow-lg"
    >
      <h2 className="border-b px-4 py-2 text-right text-xl font-light">
        IMAGE
      </h2>
      <div className="space-y-3 px-4 py-3">
        <button
          type="button"
          aria-label="이미지 자르기"
          aria-expanded={imageCropOpen}
          className="flex w-full items-center gap-3 border-b pb-3 text-left"
          onClick={() => setImageCropOpen(!imageCropOpen)}
        >
          <Crop size={19} strokeWidth={1.5} /> 자르기
        </button>
        {imageCropOpen && (
          <div className="space-y-2 border-b pb-3">
            {(
              [
                ["imageScale", "확대", 1, 3, 0.1],
                ["imageOffsetX", "가로 위치", 0, 1, 0.05],
                ["imageOffsetY", "세로 위치", 0, 1, 0.05],
              ] as const
            ).map(([field, label, min, max, step]) => (
              <label key={field} className="block text-xs">
                {label}
                <input
                  type="range"
                  aria-label={label}
                  min={min}
                  max={max}
                  step={step}
                  value={selected[field] ?? (field === "imageScale" ? 1 : 0.5)}
                  disabled={!editable}
                  onChange={(event) =>
                    patch(selected.id, {
                      [field]: Number(event.target.value),
                    })
                  }
                  className="block w-full"
                />
              </label>
            ))}
          </div>
        )}
        <div className="flex items-end gap-1">
          <span className="mb-1.5 w-14 shrink-0 text-xs">크기(mm)</span>
          <input
            aria-label="이미지 너비"
            type="number"
            step="0.1"
            min="1"
            value={selected.width}
            disabled={!editable}
            onChange={(event) =>
              setImageSize("width", Number(event.target.value))
            }
            className="min-w-0 flex-1 border px-1 py-1 text-right"
          />
          <button
            type="button"
            aria-label={imageSizeLinked ? "비율 연결 해제" : "비율 연결"}
            aria-pressed={imageSizeLinked}
            onClick={() => setImageSizeLinked(!imageSizeLinked)}
            className="mb-1 p-1"
          >
            {imageSizeLinked ? <Link size={15} /> : <Unlink size={15} />}
          </button>
          <input
            aria-label="이미지 높이"
            type="number"
            step="0.1"
            min="1"
            value={selected.height}
            disabled={!editable}
            onChange={(event) =>
              setImageSize("height", Number(event.target.value))
            }
            className="min-w-0 flex-1 border px-1 py-1 text-right"
          />
        </div>
        <div className="flex items-center gap-2 border-t pt-3 text-xs">
          <label className="flex flex-1 items-center gap-1">
            투명도
            <select
              aria-label="이미지 투명도"
              value={Math.round((selected.opacity ?? 1) * 100)}
              disabled={!editable}
              onChange={(event) =>
                patch(selected.id, {
                  opacity: Number(event.target.value) / 100,
                })
              }
              className="min-w-0 flex-1 border p-1"
            >
              {[100, 90, 80, 70, 60, 50, 40, 30, 20, 10].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-1 items-center gap-1">
            회전
            <input
              aria-label="이미지 회전"
              type="number"
              min="-360"
              max="360"
              value={selected.rotation ?? 0}
              disabled={!editable}
              onChange={(event) =>
                patch(selected.id, {
                  rotation: Math.max(
                    -360,
                    Math.min(360, Number(event.target.value))
                  ),
                })
              }
              className="w-14 min-w-0 border p-1 text-right"
            />
          </label>
        </div>
        <div className="flex items-center gap-2 border-b pb-3">
          <span className="w-14 shrink-0 text-xs">순서</span>
          {(
            [
              ["top", "맨 앞으로"],
              ["up", "앞으로"],
              ["down", "뒤로"],
              ["bottom", "맨 뒤로"],
            ] as const
          ).map(([position, label]) => (
            <button
              key={position}
              type="button"
              title={label}
              aria-label={label}
              onClick={() => setOrder(position)}
              className="p-1 hover:bg-slate-100"
            >
              <OrderIcon position={position} />
            </button>
          ))}
        </div>
        {imageMoreOpen && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <span className="w-14 shrink-0 text-xs">필터</span>
              <div className="grid min-w-0 flex-1 grid-cols-3 gap-2">
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
                    aria-pressed={(selected.imageFilter ?? "none") === filter}
                    disabled={!editable}
                    onClick={() => {
                      if (filter === "none") {
                        if (selected.originalImage)
                          patch(selected.id, {
                            image: selected.originalImage,
                            originalImage: undefined,
                            imageFilter: undefined,
                          })
                        setBrightnessOpen(false)
                      } else if (filter === "brightness")
                        setBrightnessOpen(true)
                      else {
                        setBrightnessOpen(false)
                        void applyImageFilter(filter)
                      }
                    }}
                    className={`min-w-0 text-center text-[10px] ${(selected.imageFilter ?? "none") === filter ? "font-bold text-blue-600" : ""}`}
                  >
                    <img
                      src={imageSrc(
                        selected.originalImage ?? selected.image ?? ""
                      )}
                      alt=""
                      className="h-12 w-full object-cover"
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
                    <span className="block truncate">{label}</span>
                  </button>
                ))}
              </div>
            </div>
            {brightnessOpen && (
              <div className="pl-16 text-xs">
                <input
                  aria-label="밝기 조절"
                  type="range"
                  min="0"
                  max="100"
                  value={brightness}
                  onChange={(event) =>
                    setBrightness(Number(event.target.value))
                  }
                  className="w-full"
                />
                <button
                  type="button"
                  onClick={() =>
                    void applyImageFilter("brightness", brightness)
                  }
                  className="w-full border py-1"
                >
                  밝기 적용
                </button>
              </div>
            )}
            <div className="flex gap-2 border-t pt-3">
              <button
                type="button"
                aria-label="좌우반전"
                disabled={!editable}
                onClick={() => patch(selected.id, { flipX: !selected.flipX })}
                className="border p-1"
              >
                <FlipHorizontal size={16} />
              </button>
              <button
                type="button"
                aria-label="상하반전"
                disabled={!editable}
                onClick={() => patch(selected.id, { flipY: !selected.flipY })}
                className="border p-1"
              >
                <FlipVertical size={16} />
              </button>
              <button
                type="button"
                aria-label="회전 초기화"
                disabled={!editable}
                onClick={() => patch(selected.id, { rotation: 0 })}
                className="border p-1"
              >
                <RotateCcw size={16} />
              </button>
            </div>
            <label className="block text-xs">
              이름{" "}
              <input
                aria-label="이미지 이름"
                value={selected.name}
                disabled={!editable}
                onChange={(event) =>
                  patch(selected.id, { name: event.target.value })
                }
                className="mt-1 w-full border p-1"
              />
            </label>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {(["x", "y"] as const).map((field) => (
                <label key={field}>
                  {field.toUpperCase()} 위치
                  <input
                    aria-label={`${field.toUpperCase()} 위치`}
                    type="number"
                    step="0.1"
                    value={selected[field]}
                    disabled={!editable}
                    onChange={(event) =>
                      setGeometry(field, Number(event.target.value))
                    }
                    className="mt-1 w-full border p-1"
                  />
                </label>
              ))}
            </div>
            {mode === "designer" && (
              <div className="space-y-1 text-xs">
                <label className="block">
                  <input
                    type="checkbox"
                    checked={selected.editable !== false}
                    onChange={(event) =>
                      patch(selected.id, {
                        editable: event.target.checked,
                      })
                    }
                  />{" "}
                  고객 편집 허용
                </label>
                <label className="block">
                  <input
                    type="checkbox"
                    checked={!!selected.locked}
                    onChange={(event) =>
                      patch(selected.id, { locked: event.target.checked })
                    }
                  />{" "}
                  위치 잠금
                </label>
              </div>
            )}
            {selectedPrintWarning && (
              <p className="text-xs text-red-600">
                {selectedLowDpi
                  ? "현재 크기에서 사진 해상도가 낮습니다."
                  : "인쇄 영역 밖의 부분은 출력되지 않습니다."}
              </p>
            )}
          </div>
        )}
      </div>
      <button
        type="button"
        aria-label={imageMoreOpen ? "SIMPLE" : "MORE"}
        aria-expanded={imageMoreOpen}
        onClick={() => setImageMoreOpen(!imageMoreOpen)}
        className="flex w-full items-center justify-center gap-1 border-t py-1 text-xs"
      >
        {imageMoreOpen ? (
          <>
            <ChevronUp size={14} /> SIMPLE
          </>
        ) : (
          <>
            <ChevronDown size={14} /> MORE
          </>
        )}
      </button>
    </aside>
  )
}
