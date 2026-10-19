import {
  FolderOpen,
  Type,
  ImageIcon,
  PaintBucket,
  LayoutTemplate,
  Layers,
  Shapes,
  Smile,
  QrCode,
  PenTool,
  Ruler,
  type LucideIcon,
} from "lucide-react"
import type { AlmondEditor, EditorTool } from "../../hooks/use-almond-editor"

// 망고보드 레일: 기능 묶음마다 테두리 박스 하나
const GROUPS: [EditorTool, LucideIcon, string][][] = [
  [
    ["template", LayoutTemplate, "템플릿"],
    ["shape", Shapes, "도형"],
    ["clipart", Smile, "클립아트"],
    ["text", Type, "텍스트"],
    ["background", PaintBucket, "배경"],
    ["qr", QrCode, "QR코드"],
    ["draw", PenTool, "그리기"],
  ],
  [
    ["image", ImageIcon, "업로드"],
    ["mywork", FolderOpen, "나의작업"],
  ],
  [
    ["layers", Layers, "레이어"],
    ["spec", Ruler, "규격"],
  ],
]

export function ToolNav({ editor }: { editor: AlmondEditor }) {
  const { tool, setTool, setPanelOpen, drawMode, exitDrawing } = editor
  return (
    <nav
      aria-label="편집 도구"
      className="w-[78px] shrink-0 overflow-y-auto bg-white py-[10px] pl-[10px]"
    >
      {GROUPS.map((group, index) => (
        <div
          key={index}
          className="mb-[10px] flex w-[58px] flex-col items-center gap-y-[14px] rounded-[8px] border border-[#e0e1e5] px-[7px] pt-[10px] pb-[14px]"
        >
          {group.map(([id, NavIcon, navLabel]) => {
            const on = tool === id
            return (
              <button
                key={id}
                type="button"
                title={navLabel}
                aria-label={navLabel}
                aria-pressed={on}
                onClick={() => {
                  if (drawMode && id !== "draw") exitDrawing()
                  setPanelOpen(true)
                  setTool(id)
                }}
                className={`relative flex h-[53px] w-[42px] flex-col items-center gap-y-[3px] rounded-[6px] pt-[5px] before:absolute before:top-0 before:left-[4px] before:h-[32px] before:w-[34px] before:rounded-[6px] before:transition-[background-color] before:duration-200 hover:before:bg-[#fede29] ${on ? "before:bg-[#fede29]" : "before:bg-transparent"}`}
              >
                <NavIcon
                  size={22}
                  strokeWidth={1.6}
                  className="relative text-[#20232A]"
                />
                <span className="relative h-[22px] text-[12px] leading-[22px] font-semibold whitespace-nowrap text-[#4E5255]">
                  {navLabel}
                </span>
              </button>
            )
          })}
        </div>
      ))}
    </nav>
  )
}
