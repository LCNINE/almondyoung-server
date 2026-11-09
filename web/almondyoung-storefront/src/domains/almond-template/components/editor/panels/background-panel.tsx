import { useRef } from "react"
import { PrintColorPicker } from "../../color-picker"
import type { AlmondEditor } from "../../../hooks/use-almond-editor"
import {
  sideBackground,
  withSideBackground,
  type SideBackground,
} from "../../../lib/document"
import { GrayButton } from "../object-properties"
import { PropSlider, SettingBox, Toggle } from "../prop-sections"
import { TextureSettingFields } from "../style-controls"
import { ColorFilterFields, GradientControls } from "../layer-style-controls"

export function BackgroundPanel({ editor }: { editor: AlmondEditor }) {
  const {
    design,
    side,
    change,
    imageFile,
    backgroundSelected,
    removeBackgroundImage,
  } = editor
  const bg = sideBackground(design, side)
  const backgroundInputRef = useRef<HTMLInputElement>(null)
  const setTexture = (backgroundTexture: SideBackground["backgroundTexture"]) =>
    change(withSideBackground(design, side, { ...bg, backgroundTexture }))

  return (
    <>
      <PrintColorPicker
        label="배경색"
        value={bg.background}
        compact
        onApply={(color) =>
          change(withSideBackground(design, side, { ...bg, background: color }))
        }
      />
      <div className="mt-4">
        {/* 그라데이션은 배경색 위, 배경 사진 아래에 깔린다. 투명도를 낮추면 배경색이 비친다 */}
        <GradientControls
          value={bg.backgroundGradient}
          startColor={bg.background}
          disabled={false}
          onChange={(backgroundGradient) =>
            change(
              withSideBackground(design, side, { ...bg, backgroundGradient })
            )
          }
        />
      </div>
      <div className="mt-4">
        {/* 질감은 배경색·그라데이션·배경 사진을 한꺼번에 덮는다 */}
        <Toggle
          label="질감"
          checked={!!bg.backgroundTexture}
          onChange={(checked) => setTexture(checked ? {} : undefined)}
        />
        {bg.backgroundTexture && (
          <SettingBox title="질감 설정" onClear={() => setTexture(undefined)}>
            <TextureSettingFields
              value={{
                ...bg.backgroundTexture,
                textureKind: bg.backgroundTexture.textureKind ?? "grain",
              }}
              disabled={false}
              onChange={(patch) => {
                const next = { ...bg.backgroundTexture, ...patch }
                setTexture({
                  textureKind: next.textureKind,
                  textureAmount: next.textureAmount,
                  textureScale: next.textureScale,
                })
              }}
            />
          </SettingBox>
        )}
      </div>
      <div className="mt-5 border-t" />
      <button
        className="mt-5 w-full border py-2 text-sm hover:bg-slate-50"
        onClick={() => backgroundInputRef.current?.click()}
      >
        + 내 PC 이미지 불러오기
      </button>
      {bg.backgroundImage && (
        <div
          className={`mt-3 rounded-[7px] p-3 ${backgroundSelected ? "bg-[#e9fbfc] ring-1 ring-[#42dfe5]" : "bg-[#f6f7f9]"}`}
        >
          <p className="mb-2 text-[13px] leading-[19px] text-[#3F4250]">
            {backgroundSelected
              ? "배경 이미지를 골랐습니다. Delete 키로도 지울 수 있습니다."
              : "캔버스의 빈 곳을 누르면 배경 이미지를 고를 수 있습니다."}
          </p>
          <GrayButton onClick={removeBackgroundImage}>
            배경 이미지 삭제
          </GrayButton>
        </div>
      )}
      {bg.backgroundImage && (
        <div className="mt-5 space-y-[15px]">
          <ColorFilterFields
            value={bg.backgroundFilter}
            disabled={false}
            onChange={(backgroundFilter) =>
              change(
                withSideBackground(design, side, { ...bg, backgroundFilter })
              )
            }
          />
          <PropSlider
            label="블러"
            min={0}
            max={100}
            value={bg.backgroundBlur ?? 0}
            disabled={false}
            onValue={(backgroundBlur) =>
              change(
                withSideBackground(design, side, {
                  ...bg,
                  backgroundBlur: backgroundBlur || undefined,
                })
              )
            }
          />
        </div>
      )}
      <input
        ref={backgroundInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void imageFile(file, "background")
          e.target.value = ""
        }}
      />
    </>
  )
}
