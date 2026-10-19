import { useState, useSyncExternalStore } from "react"
import { ChevronDown, ChevronLeft, ChevronRight, Info } from "lucide-react"
import type { AlmondEditor } from "../../../hooks/use-almond-editor"
import {
  FONT_CATEGORIES,
  fontOptions,
  loadUploadedFont,
  subscribeFontOptions,
  type FontCategory,
} from "../../../lib/fonts"
import { FontUpload } from "../font-upload"

const SPECIAL: [string, string][] = [
  ["♧ 일반기호", "♧♣♤♠♡♥♢◆◇○●◎□■△▲▽▼☆★※☏☎♨☜☞♪♬♩♭✓✔✕✖"],
  ["… 문장부호", "…‥·ㆍ¨〃―∥＼∼´～ˇ˘˝˚˙¸˛¡¿ː「」『』【】〈〉《》"],
  ["×÷ 수학기호", "±×÷≠≤≥∞∴∵∫∬∮√∝∂∇≡≒≪≫∈∋⊆⊇⊂⊃∪∩∧∨¬⇒⇔∀∃"],
  ["① 원·괄호문자", "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮㉠㉡㉢㉣㉤㉥㉦㉧㉨㉩⑴⑵⑶⑷⑸⒜⒝⒞"],
  ["→ 화살표·괘선", "←→↑↓↔↕↗↙↖↘⇒⇔─│┌┐┘└├┬┤┴┼━┃┏┓┛┗┣┳┫┻╋"],
  ["℃ 단위기호", "℃℉Å￠￡￥¤‰㎕㎖㎗ℓ㎘㎣㎤㎥㎦㎙㎚㎛㎜㎝㎞㎟㎠㎡㎢㏊㎍㎎㎏㏏"],
  ["Æ 라틴 문자", "ÆÐªĦĲĿŁØŒºÞŦŊæđðħıĳĸŀłøœßþŧŋŉÀÁÂÃÄÅÇÈÉÊË"],
  ["β 그리스 문자", "ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩαβγδεζηθικλμνξοπρστυφχψω"],
  [
    "あ 일본 문자",
    "ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつ",
  ],
  ["ⅶ 라틴 숫자", "ⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ"],
]

function useFonts() {
  return useSyncExternalStore(subscribeFontOptions, fontOptions, fontOptions)
}

export function TextPanel({ editor }: { editor: AlmondEditor }) {
  const { add, mode } = editor
  const fonts = useFonts()
  const [tab, setTab] = useState<"text" | "special">("text")
  const [chip, setChip] = useState<"all" | "type">("all")
  const [list, setList] = useState<FontCategory | null>(null)
  const [special, setSpecial] = useState(0)
  const [specialOpen, setSpecialOpen] = useState(false)
  const categories = FONT_CATEGORIES.filter((name) =>
    fonts.some((font) => font.category === name)
  )
  const addText = (fontFamily?: string, text = "더블클릭하여 편집하세요") => {
    const go = () =>
      add("text", { text, ...(fontFamily ? { fontFamily } : {}) })
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
        return (
          <button
            key={name}
            type="button"
            onClick={() => setList(name)}
            className="group/type flex w-[74px] flex-col items-center gap-1"
          >
            <span
              className="flex size-[74px] flex-col items-center justify-center rounded-[6px] bg-[#F6F7F9] text-[15px] leading-tight text-[#20232A] outline-1 outline-offset-[3px] outline-transparent transition-[outline-color] duration-200 group-hover/type:outline group-hover/type:outline-[#6f717c]"
              style={{ fontFamily: sample?.value }}
            >
              <span>한글</span>
              <span>Abc</span>
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
        {(
          [
            ["text", "텍스트"],
            ["special", "특수문자"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
            className={`relative px-2 py-[10px] text-[14px] leading-[16.71px] ${tab === id ? "font-semibold text-[#20232A]" : "text-[#70777F]"}`}
          >
            {label}
            <span
              className={`absolute right-0 bottom-[-1px] left-0 h-[3px] bg-[#fede29] transition-all duration-300 ${tab === id ? "opacity-100" : "opacity-0"}`}
            />
          </button>
        ))}
      </div>
      {tab === "text" ? (
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
      ) : (
        <div className="px-[13px] pt-4 pb-5">
          <div className="relative">
            <button
              type="button"
              onClick={() => setSpecialOpen(!specialOpen)}
              className="flex h-[38px] w-full items-center justify-between rounded-[6px] border border-[#e0e1e5] bg-white py-[10.5px] pr-1.5 pl-[10px] text-[14px] text-[#3F4250]"
            >
              {SPECIAL[special][0]}
              <ChevronDown className="size-4" />
            </button>
            {specialOpen && (
              <ul className="absolute top-full right-0 left-0 z-20 mt-1 rounded-[6px] border border-[#e0e1e5] bg-white py-[10px] pr-[19px] pl-[10px]">
                {SPECIAL.map(([name], index) => (
                  <li key={name}>
                    <button
                      type="button"
                      onClick={() => {
                        setSpecial(index)
                        setSpecialOpen(false)
                      }}
                      className={`h-[38px] w-full rounded-[6px] px-[10px] text-left text-[14px] text-[#3F4250] hover:bg-[#F3F5F8] ${special === index ? "bg-[#f6f7f9]" : ""}`}
                    >
                      {name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="mt-3 flex gap-2 rounded-[6px] bg-[#F6F7F9] p-3 text-[13px] leading-[21px] text-[#3F4250]">
            <Info className="mt-0.5 size-4 shrink-0" />
            <span>
              누르면 그 문자로 새 텍스트가 들어갑니다. 텍스트 안에 넣으려면 그
              텍스트를 두 번 눌러 고칠 때 복사해 붙여 넣으세요.
            </span>
          </p>
          <h3 className="mt-[10px] mb-[9px] text-[15px] text-[#20232A]">
            {SPECIAL[special][0].split(" ")[1]}
          </h3>
          <div className="grid grid-cols-8 gap-[6px]">
            {Array.from(SPECIAL[special][1]).map((char) => (
              <button
                key={char}
                type="button"
                aria-label={`${char} 넣기`}
                onClick={() => addText(undefined, char)}
                className="flex h-9 w-[35px] items-center justify-center rounded-[6px] border border-[#f1f3f6] text-[14px] text-[#20232A] outline-1 outline-offset-[3px] outline-transparent hover:outline hover:outline-[#6f717c]"
              >
                {char}
              </button>
            ))}
          </div>
        </div>
      )}
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
