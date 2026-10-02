import {
  Type,
  ImageIcon,
  PaintBucket,
  LayoutTemplate,
  Layers,
  Shapes,
  Smile,
  Frame,
  QrCode,
} from "lucide-react"
import type { AlmondEditor } from "../../hooks/use-almond-editor"

export function ToolNav({ editor }: { editor: AlmondEditor }) {
  const { tool, setTool, panelOpen, setPanelOpen } = editor
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
          ["clipart", Smile, "클립아트"],
          ["frame", Frame, "모양틀"],
          ["qr", QrCode, "QR코드"],
          ["spec", LayoutTemplate, "규격"],
        ] as const
      ).map(([id, Icon, label]) => (
        <button
          key={id}
          type="button"
          title={label}
          aria-label={label}
          aria-pressed={tool === id && panelOpen}
          onClick={() => {
            setPanelOpen(tool === id ? !panelOpen : true)
            setTool(id)
          }}
          className={`flex h-[56px] shrink-0 flex-col items-center justify-center gap-0.5 border-b ${tool === id && panelOpen ? "bg-[#3972d5] text-white" : "text-[#333] hover:bg-slate-100"}`}
        >
          <Icon size={23} strokeWidth={1.6} />
          <span className="text-[10px] leading-none tracking-tight">
            {label}
          </span>
        </button>
      ))}
    </nav>
  )
}
