import { useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { CLIPART, SHAPES } from "../../lib/art-library"
import type { AlmondEditor } from "../../hooks/use-almond-editor"
import { useQrBuilder } from "../../hooks/use-qr-builder"
import { BackgroundPanel } from "./panels/background-panel"
import { ClipartPanel } from "./panels/clipart-panel"
import { ImagePanel } from "./panels/image-panel"
import { LayersPanel } from "./panels/layers-panel"
import { QrPanel } from "./panels/qr-panel"
import { ShapePanel } from "./panels/shape-panel"
import { SpecPanel } from "./panels/spec-panel"
import { TemplatePanel } from "./panels/template-panel"
import { TextPanel } from "./panels/text-panel"

export function ToolPanel({ editor }: { editor: AlmondEditor }) {
  const { tool, panelOpen, add, patch, selected, editable, setMessage } = editor
  const [templateSearch, setTemplateSearch] = useState("")
  const [shapeCategory, setShapeCategory] =
    useState<keyof typeof SHAPES>("기본도형")
  const [shapeColumns, setShapeColumns] = useState<1 | 2>(2)
  const [clipartCategory, setClipartCategory] =
    useState<keyof typeof CLIPART>("크리스마스")
  const [clipartColumns, setClipartColumns] = useState<1 | 2>(2)
  const [wide, setWide] = useState(false)
  const gallery = ["template", "image", "shape", "clipart"].includes(tool)
  const qr = useQrBuilder({
    add,
    patch,
    selected,
    editable: !!editable,
    setMessage,
  })
  return (
    <div hidden={!panelOpen} className="relative z-10 flex shrink-0">
      <aside
        data-wide={(wide && gallery) || undefined}
        className={`group/panel border-r bg-white p-5 ${wide && gallery ? "w-[560px]" : "w-[300px]"} ${tool === "background" || tool === "text" ? "overflow-visible" : "overflow-y-auto"}`}
      >
        {tool === "spec" && <SpecPanel editor={editor} />}
        {tool === "text" && <TextPanel editor={editor} />}
        {tool === "image" && <ImagePanel editor={editor} />}
        {tool === "background" && <BackgroundPanel editor={editor} />}
        {tool === "template" && (
          <TemplatePanel
            editor={editor}
            templateSearch={templateSearch}
            setTemplateSearch={setTemplateSearch}
          />
        )}
        {tool === "shape" && (
          <ShapePanel
            editor={editor}
            shapeCategory={shapeCategory}
            setShapeCategory={setShapeCategory}
            shapeColumns={shapeColumns}
            setShapeColumns={setShapeColumns}
          />
        )}
        {tool === "clipart" && (
          <ClipartPanel
            editor={editor}
            clipartCategory={clipartCategory}
            setClipartCategory={setClipartCategory}
            clipartColumns={clipartColumns}
            setClipartColumns={setClipartColumns}
          />
        )}
        {tool === "qr" && <QrPanel qr={qr} />}
        {tool === "layers" && <LayersPanel editor={editor} />}
      </aside>
      {gallery && (
        <button
          type="button"
          aria-label={wide ? "패널 좁게 보기" : "패널 넓게 보기"}
          title={wide ? "좁게 보기" : "넓게 보기"}
          onClick={() => setWide(!wide)}
          className="text-muted-foreground hover:text-foreground absolute top-1/2 -right-3 flex h-12 w-3 -translate-y-1/2 items-center justify-center rounded-r-md border border-l-0 bg-white"
        >
          {wide ? (
            <ChevronLeft className="size-3" aria-hidden="true" />
          ) : (
            <ChevronRight className="size-3" aria-hidden="true" />
          )}
        </button>
      )}
    </div>
  )
}
