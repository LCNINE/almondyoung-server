import {
  Type,
  ImageIcon,
  PaintBucket,
  LayoutTemplate,
  Layers,
  Shapes,
  Smile,
  QrCode,
  PenTool,
  Pencil,
} from "lucide-react"
import type { AlmondEditor } from "../../hooks/use-almond-editor"

export function ToolNav({ editor }: { editor: AlmondEditor }) {
  const {
    tool,
    setTool,
    panelOpen,
    setPanelOpen,
    drawMode,
    pencilActive,
    togglePen,
    exitDrawing,
  } = editor
  return (
    <nav
      aria-label="편집 도구"
      className="flex w-[56px] shrink-0 flex-col overflow-y-auto border-r bg-white"
    >
      {(
        [
          ["text", Type, "텍스트"],
          ["image", ImageIcon, "이미지"],
          ["background", PaintBucket, "배경색"],
          ["template", LayoutTemplate, "템플릿"],
          ["layers", Layers, "레이어"],
          ["shape", Shapes, "도형"],
          ["pen", PenTool, "펜"],
          ["clipart", Smile, "클립아트"],
          ["qr", QrCode, "QR코드"],
          ["spec", LayoutTemplate, "규격"],
        ] as const
      ).map(([id, NavIcon, navLabel]) => {
        // 펜 칸은 마지막에 고른 그리기 도구(펜/연필)를 보여 주고, 누르면 그리기를 켜고 끈다
        const drawing = id === "pen"
        const Icon = drawing && pencilActive ? Pencil : NavIcon
        const label = drawing && pencilActive ? "연필" : navLabel
        const on = drawing ? !!drawMode : tool === id && panelOpen
        return (
          <button
            key={id}
            type="button"
            title={drawing ? `${label} (P / Shift+P)` : label}
            aria-label={label}
            aria-pressed={on}
            onClick={() => {
              if (drawing) return drawMode ? exitDrawing() : togglePen()
              setPanelOpen(tool === id ? !panelOpen : true)
              setTool(id)
            }}
            className={`flex h-[56px] shrink-0 flex-col items-center justify-center gap-0.5 border-b ${on ? "bg-[#3972d5] text-white" : "text-[#333] hover:bg-slate-100"}`}
          >
            <Icon size={23} strokeWidth={1.6} />
            <span className="text-[10px] leading-none tracking-tight">
              {label}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
