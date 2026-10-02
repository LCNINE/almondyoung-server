import { useRef } from "react"
import { PrintColorPicker } from "../../color-picker"
import type { AlmondEditor } from "../../../hooks/use-almond-editor"

export function BackgroundPanel({ editor }: { editor: AlmondEditor }) {
  const { design, change, imageFile } = editor
  const backgroundInputRef = useRef<HTMLInputElement>(null)
  return (
    <>
      <PrintColorPicker
        label="배경색"
        value={design.background}
        compact
        onApply={(color) => change({ ...design, background: color })}
      />
      <div className="mt-5 border-t" />
      <button
        className="mt-5 w-full border py-2 text-sm hover:bg-slate-50"
        onClick={() => backgroundInputRef.current?.click()}
      >
        + 내 PC 이미지 불러오기
      </button>
      {design.backgroundImage && (
        <button
          className="mt-2 w-full bg-[#303030] py-2 text-sm text-white"
          onClick={() =>
            change({
              ...design,
              backgroundImage: undefined,
              backgroundPixelWidth: undefined,
              backgroundPixelHeight: undefined,
            })
          }
        >
          배경삭제
        </button>
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
