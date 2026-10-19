import { useRef } from "react"
import { PrintColorPicker } from "../../color-picker"
import type { AlmondEditor } from "../../../hooks/use-almond-editor"
import { sideBackground, withSideBackground } from "../../../lib/document"
import { GrayButton } from "../object-properties"

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
