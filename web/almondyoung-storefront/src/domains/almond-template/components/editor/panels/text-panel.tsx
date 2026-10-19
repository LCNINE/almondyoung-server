import { useState, useSyncExternalStore } from "react"
import { ChevronLeft, ChevronRight, FolderOpen } from "lucide-react"
import type { AlmondEditor } from "../../../hooks/use-almond-editor"
import {
  FONT_CATEGORIES,
  fontOptions,
  loadUploadedFont,
  subscribeFontOptions,
  type FontCategory,
} from "../../../lib/fonts"
import { FontUpload } from "../font-upload"

function useFonts() {
  return useSyncExternalStore(subscribeFontOptions, fontOptions, fontOptions)
}

export function TextPanel({ editor }: { editor: AlmondEditor }) {
  const { add, mode } = editor
  const fonts = useFonts()
  const [chip, setChip] = useState<"all" | "type">("all")
  const [list, setList] = useState<FontCategory | null>(null)
  const categories = FONT_CATEGORIES.filter((name) =>
    fonts.some((font) => font.category === name)
  )
  const addText = (fontFamily?: string) => {
    const go = () =>
      add("text", {
        text: "더블클릭하여 편집하세요",
        ...(fontFamily ? { fontFamily } : {}),
      })
    if (!fontFamily)
      return go()
      // 아직 안 받은 웹폰트로 재면 대체 글꼴 폭으로 상자가 맞춰진다
    ;(loadUploadedFont(fontFamily) ?? document.fonts.load(`16px ${fontFamily}`))
      .catch(() => undefined)
      .finally(go)
  }
  const typeTiles = (limit?: number) => (
    <div className="flex flex-wrap gap-x-[9px] gap-y-[18px]">
      {categories.slice(0, limit).map((name) => {
        const sample = fonts.find((font) => font.category === name)
        const extra = name === "추가 글꼴"
        return (
          <button
            key={name}
            type="button"
            onClick={() => setList(name)}
            className="group/type flex w-[74px] flex-col items-center gap-1"
          >
            <span
              className="flex size-[74px] flex-col items-center justify-center rounded-[6px] bg-[#F6F7F9] text-[15px] leading-tight text-[#20232A] outline-1 outline-offset-[3px] outline-transparent transition-[outline-color] duration-200 group-hover/type:outline group-hover/type:outline-[#6f717c]"
              style={extra ? undefined : { fontFamily: sample?.value }}
            >
              {extra ? (
                // 디자이너가 더한 글꼴 묶음이라 견본 대신 폴더와 개수로 기본 분류와 구별한다
                <>
                  <FolderOpen size={24} strokeWidth={1.5} />
                  <span className="mt-1 text-[12px] text-[#70777F]">
                    {fonts.filter((font) => font.category === name).length}종
                  </span>
                </>
              ) : (
                <>
                  <span>한글</span>
                  <span>Abc</span>
                </>
              )}
            </span>
            <span className="text-[12px] leading-[14.32px] tracking-[-0.025em] text-[#3F4250]">
              {name}
            </span>
          </button>
        )
      })}
    </div>
  )
  return (
    <div className="relative -m-5 min-h-full overflow-hidden">
      <div className="relative mx-[13px] mt-[17px] flex border-b border-[#e6e7ea]">
        <span className="relative px-2 py-[10px] text-[14px] leading-[16.71px] font-semibold text-[#20232A]">
          텍스트
          <span className="absolute right-0 bottom-[-1px] left-0 h-[3px] bg-[#fede29]" />
        </span>
      </div>
      <div className="px-[13px]">
        <div className="flex flex-wrap border-b border-[#e6e7ea] py-[15px]">
          {(
            [
              ["all", "전체"],
              ["type", "유형별 폰트"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={chip === id}
              onClick={() => setChip(id)}
              className={`h-7 rounded-[5px] border p-1.5 text-[13px] leading-none transition-[border-color] duration-500 ${chip === id ? "border-[#fede29] font-medium text-[#20232A]" : "border-transparent text-[#70777F]"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {chip === "all" ? (
          <div className="space-y-[10px] pt-4 pb-5">
            <button
              type="button"
              onClick={() => addText()}
              className="flex h-[55px] w-full items-center justify-center rounded-[6px] bg-[#f6f7f9] text-[15px] font-semibold text-[#3F4250] outline-1 outline-offset-[3px] outline-transparent transition-[outline-color] duration-200 hover:outline hover:outline-[#6f717c]"
            >
              기본 텍스트 추가하기
            </button>
            <div className="flex items-center justify-between pt-4 pb-5">
              <h3 className="pr-[5px] text-[15px] text-[#20232A]">
                유형별 폰트
              </h3>
              <button
                type="button"
                onClick={() => setChip("type")}
                className="mr-[3px] flex items-center gap-1 text-[13px] text-[#70777F]"
              >
                더보기 <ChevronRight className="size-3.5" />
              </button>
            </div>
            {typeTiles(8)}
          </div>
        ) : (
          <div className="pt-4 pb-5">{typeTiles()}</div>
        )}
        {mode === "designer" && <FontUpload editor={editor} />}
      </div>
      <div
        aria-hidden={!list}
        inert={!list}
        className={`absolute top-0 bottom-0 z-10 w-full overflow-y-auto bg-white px-[14px] transition-[left] duration-300`}
        style={{ left: list ? 0 : "-100%" }}
      >
        <button
          type="button"
          onClick={() => setList(null)}
          className="mt-5 flex items-center gap-1 text-[16px] font-medium text-[#20232A]"
        >
          <ChevronLeft className="size-5" />
          {list}
        </button>
        <ul className="mt-4 space-y-[10px]">
          {fonts
            .filter((font) => font.category === list)
            .map((font) => (
              <li key={font.value}>
                <button
                  type="button"
                  onClick={() => addText(font.value)}
                  className="flex h-[42px] w-full items-center rounded-[7px] bg-[#F6F7F9] px-3 text-left text-[16px] text-[#20232A] hover:bg-[#eef0f3]"
                  style={{ fontFamily: font.value }}
                >
                  {font.label}
                </button>
              </li>
            ))}
        </ul>
      </div>
    </div>
  )
}
