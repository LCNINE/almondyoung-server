import { useState } from "react"
import { CLIPART, SHAPES } from "../../lib/art-library"
import type { AlmondEditor } from "../../hooks/use-almond-editor"
import { useQrBuilder } from "../../hooks/use-qr-builder"
import { BackgroundPanel } from "./panels/background-panel"
import { ClipartPanel } from "./panels/clipart-panel"
import { FramePanel } from "./panels/frame-panel"
import { ImagePanel } from "./panels/image-panel"
import { LayersPanel } from "./panels/layers-panel"
import { QrPanel } from "./panels/qr-panel"
import { ShapePanel } from "./panels/shape-panel"
import { SpecPanel } from "./panels/spec-panel"
import { TemplatePanel } from "./panels/template-panel"
import { TextPanel } from "./panels/text-panel"

export function ToolPanel({ editor }: { editor: AlmondEditor }) {
  const {
    tool,
    panelOpen,
    design,
    add,
    patch,
    selected,
    editable,
    setMessage,
  } = editor
  const [templateSearch, setTemplateSearch] = useState("")
  const [shapeCategory, setShapeCategory] =
    useState<keyof typeof SHAPES>("기본도형")
  const [shapeColumns, setShapeColumns] = useState<1 | 2>(2)
  const [clipartCategory, setClipartCategory] =
    useState<keyof typeof CLIPART>("크리스마스")
  const [clipartColumns, setClipartColumns] = useState<1 | 2>(2)
  const [frameCategory, setFrameCategory] = useState("기본모양틀")
  const [frameColumns, setFrameColumns] = useState<1 | 2>(2)
  const qr = useQrBuilder({
    design,
    add,
    patch,
    selected,
    editable: !!editable,
    setMessage,
  })
  return (
    <aside
      hidden={!panelOpen}
      className={`relative z-10 w-[300px] shrink-0 border-r bg-white p-5 ${tool === "background" ? "overflow-visible" : "overflow-y-auto"}`}
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
      {tool === "frame" && (
        <FramePanel
          editor={editor}
          frameCategory={frameCategory}
          setFrameCategory={setFrameCategory}
          frameColumns={frameColumns}
          setFrameColumns={setFrameColumns}
        />
      )}
      {tool === "qr" && <QrPanel qr={qr} />}
      {tool === "layers" && <LayersPanel editor={editor} />}
    </aside>
  )
}
