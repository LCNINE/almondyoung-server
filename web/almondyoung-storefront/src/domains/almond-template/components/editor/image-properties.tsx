import { PhotoEffectControls } from "./photo-effect-controls"
import { useRef } from "react"
import { Link, Unlink, Crop, Eraser } from "lucide-react"
import type { Layer } from "../../lib/document"
import { GrayButton } from "./object-properties"
import { PrintColorPicker } from "../color-picker"
import {
  AlignOrderSection,
  NumberBox,
  OpacitySection,
  PropHeader,
  PropSection,
  PropSlider,
  SettingBox,
  Toggle,
} from "./prop-sections"
import type { AlmondEditor } from "../../hooks/use-almond-editor"
import type { PropertyPanelState } from "../../hooks/use-property-panel"
import { useImageSrc } from "../../lib/image-previews"

export function ImageProperties({
  editor,
  panel,
  selected,
  inline = false,
}: {
  editor: AlmondEditor
  panel: PropertyPanelState
  selected: Layer
  inline?: boolean
}) {
  const imageSrc = useImageSrc()
  const replacementInput = useRef<HTMLInputElement>(null)
  const {
    mode,
    selectedLowDpi,
    selectedPrintWarning,
    patch,
    editable,
    applyImageFilter,
  } = editor
  const {
    brightnessOpen,
    setBrightnessOpen,
    imageSizeLinked,
    setImageSizeLinked,
    brightness,
    setBrightness,
    setImageSize,
  } = panel
  const disabled = !editable
  const filters = [
    ["원본", "none"],
    ["흑백", "grayscale"],
    ["엠보스", "emboss"],
    ["흐림", "boxblur"],
    ["밝기", "brightness"],
    ["세피아", "sepia"],
  ] as const
  return (
    <aside
      aria-label="이미지 속성"
      className={
        inline
          ? "w-full bg-white text-sm"
          : "absolute top-[18%] right-5 z-20 max-h-[72%] w-[285px] overflow-y-auto border bg-white text-sm shadow-lg"
      }
      style={inline ? undefined : panel.panelStyle}
    >
      <PropHeader title="사진" />
      <AlignOrderSection editor={editor} layer={selected} />
      <PropSection className="flex items-end gap-[6px] py-5">
        <NumberBox
          label="너비"
          value={selected.width}
          step={0.5}
          min={1}
          width={82}
          disabled={disabled}
          onValue={(value) => setImageSize("width", value)}
        />
        <button
          type="button"
          aria-label={imageSizeLinked ? "비율 연결 해제" : "비율 연결"}
          aria-pressed={imageSizeLinked}
          onClick={() => setImageSizeLinked(!imageSizeLinked)}
          className="mb-[12px] text-[#70777F]"
        >
          {imageSizeLinked ? <Link size={15} /> : <Unlink size={15} />}
        </button>
        <NumberBox
          label="높이"
          value={selected.height}
          step={0.5}
          min={1}
          width={82}
          disabled={disabled}
          onValue={(value) => setImageSize("height", value)}
        />
        <NumberBox
          label="회전"
          value={selected.rotation ?? 0}
          min={-360}
          max={360}
          width={70}
          disabled={disabled}
          onValue={(value) => patch(selected.id, { rotation: value })}
        />
        <span className="pb-[10px] text-[14px] text-[#70777F]">mm</span>
      </PropSection>
      <PropSection className="py-5">
        <input
          ref={replacementInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          aria-label="교체할 사진"
          disabled={disabled}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void editor.imageFile(file, "frame")
            event.target.value = ""
          }}
        />
        <div className="mb-[10px]">
          <GrayButton
            disabled={disabled}
            onClick={() => replacementInput.current?.click()}
          >
            사진 교체
          </GrayButton>
        </div>
        <GrayButton
          disabled={disabled}
          onClick={() =>
            editor.cropId === selected.id
              ? editor.setCropId(null)
              : editor.startCrop()
          }
        >
          <Crop size={16} strokeWidth={1.5} className="mr-[6px]" />
          {editor.cropId === selected.id ? "자르기 완료" : "자르기 (더블클릭)"}
        </GrayButton>
        <div className="mt-[10px]">
          <GrayButton
            disabled={disabled}
            onClick={() => void editor.removeWhiteBackground()}
          >
            <Eraser size={16} strokeWidth={1.5} className="mr-[6px]" />
            배경 지우기
          </GrayButton>
        </div>
        <p className="mt-2 text-[13px] leading-[19px] text-[#70777F]">
          가장자리와 이어진 바탕색을 투명하게 만듭니다. 로고·도장처럼 단색 바탕
          위 그림에 맞고, 풍경 사진처럼 복잡한 바탕은 지워지지 않습니다.
        </p>
      </PropSection>
      <PropSection className="py-5">
        <PrintColorPicker
          label="색 입히기"
          value={selected.imageTint ?? "none"}
          disabled={disabled}
          onClear={() => patch(selected.id, { imageTint: undefined })}
          onApply={(color) => patch(selected.id, { imageTint: color })}
        />
        <p className="mt-2 text-[13px] leading-[19px] text-[#70777F]">
          배경이 투명한 로고·아이콘에 쓰면 모양은 그대로 두고 색만 바뀝니다.
        </p>
      </PropSection>
      <PropSection className="space-y-[15px] py-[25px]">
        <h3 className="text-[16px] font-medium text-[#20232A]">필터</h3>
        <div className="grid grid-cols-3 gap-[10px]">
          {filters.map(([label, filter]) => {
            const active = (selected.imageFilter ?? "none") === filter
            return (
              <button
                key={filter}
                type="button"
                aria-label={`${label} 필터`}
                aria-pressed={active}
                disabled={disabled}
                onClick={() => {
                  if (filter === "none") {
                    if (selected.originalImage)
                      patch(selected.id, {
                        image: selected.originalImage,
                        originalImage: undefined,
                        imageFilter: undefined,
                      })
                    setBrightnessOpen(false)
                  } else if (filter === "brightness") setBrightnessOpen(true)
                  else {
                    setBrightnessOpen(false)
                    void applyImageFilter(filter)
                  }
                }}
                className="text-center text-[12px] text-[#3F4250]"
              >
                <span
                  className={`block overflow-hidden rounded-[7px] border-2 ${active ? "border-[#6f717c]" : "border-transparent"}`}
                >
                  <img
                    src={imageSrc(
                      selected.originalImage ?? selected.image ?? ""
                    )}
                    alt=""
                    className="h-[70px] w-full bg-[#f6f7f9] object-cover"
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
                </span>
                <span className="mt-1 block truncate">{label}</span>
              </button>
            )
          })}
        </div>
        {brightnessOpen && (
          <SettingBox
            title="밝기 설정"
            onClear={() => setBrightnessOpen(false)}
          >
            <PropSlider
              label="밝기"
              min={0}
              max={100}
              value={brightness}
              onValue={setBrightness}
            />
            <GrayButton
              onClick={() => void applyImageFilter("brightness", brightness)}
            >
              밝기 적용
            </GrayButton>
          </SettingBox>
        )}
      </PropSection>
      <PropSection className="space-y-[15px] py-5">
        <h3 className="text-[16px] font-medium text-[#20232A]">가로 번짐</h3>
        <PropSlider
          label="번짐 강도"
          min={0}
          max={100}
          value={selected.imageMotionBlur ?? 0}
          disabled={disabled}
          onValue={(value) => patch(selected.id, { imageMotionBlur: value })}
        />
        <PropSlider
          label="효과 농도"
          min={0}
          max={100}
          value={selected.imageMotionMix ?? 60}
          disabled={disabled || !(selected.imageMotionBlur ?? 0)}
          onValue={(value) => patch(selected.id, { imageMotionMix: value })}
        />
        <GrayButton
          disabled={disabled || !(selected.imageMotionBlur ?? 0)}
          onClick={() =>
            patch(selected.id, {
              imageMotionBlur: undefined,
              imageMotionMix: undefined,
            })
          }
        >
          번짐 해제
        </GrayButton>
        <p className="text-[13px] leading-[19px] text-[#70777F]">
          사진을 교체해도 번짐 설정은 유지됩니다. 글자와 도형에는 적용되지
          않습니다.
        </p>
      </PropSection>
      <PhotoEffectControls editor={editor} selected={selected} />
      <OpacitySection
        value={selected.opacity}
        disabled={disabled}
        onValue={(opacity) => patch(selected.id, { opacity })}
      />
      {mode === "designer" && (
        <PropSection className="py-[15px]">
          <Toggle
            label="고객 편집 허용"
            checked={selected.editable !== false}
            onChange={(checked) => patch(selected.id, { editable: checked })}
          />
          <Toggle
            label="위치 잠금"
            checked={!!selected.locked}
            onChange={(checked) => patch(selected.id, { locked: checked })}
          />
        </PropSection>
      )}
      {selectedPrintWarning && (
        <p className="px-[13px] py-[15px] text-[13px] text-[#FE6767]">
          {selectedLowDpi
            ? "현재 크기에서 사진 해상도가 낮습니다."
            : "인쇄 영역 밖의 부분은 출력되지 않습니다."}
        </p>
      )}
    </aside>
  )
}
