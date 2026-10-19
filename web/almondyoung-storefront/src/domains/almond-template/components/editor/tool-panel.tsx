import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { CLIPART, SHAPES } from "../../lib/art-library"
import type { AlmondEditor } from "../../hooks/use-almond-editor"
import { useQrBuilder } from "../../hooks/use-qr-builder"
import { BackgroundPanel } from "./panels/background-panel"
import { ClipartPanel } from "./panels/clipart-panel"
import { ImagePanel } from "./panels/image-panel"
import { LayersPanel } from "./panels/layers-panel"
import { MyWorkPanel } from "./panels/my-work-panel"
import { DrawPanel } from "./panels/draw-panel"
import { PropertyPanel } from "./property-panel"
import { QrPanel } from "./panels/qr-panel"
import { ShapePanel } from "./panels/shape-panel"
import { SpecPanel } from "./panels/spec-panel"
import { TemplatePanel } from "./panels/template-panel"
import { TextPanel } from "./panels/text-panel"

export function ToolPanel({ editor }: { editor: AlmondEditor }) {
  const {
    tool,
    panelOpen,
    setPanelOpen,
    add,
    patch,
    selected,
    group,
    editable,
    setMessage,
  } = editor
  // 레이어 패널은 고르면서 쓰는 곳이라 속성으로 바꾸지 않는다
  const inspecting =
    tool !== "layers" &&
    ((!!selected && selected.visible !== false) || group.length > 1)
  useEffect(() => {
    if (inspecting) setPanelOpen(true)
  }, [inspecting])
  const [templateSearch, setTemplateSearch] = useState("")
  const [shapeCategory, setShapeCategory] =
    useState<keyof typeof SHAPES>("기본도형")
  const [shapeColumns, setShapeColumns] = useState<1 | 2>(2)
  const [clipartCategory, setClipartCategory] =
    useState<keyof typeof CLIPART>("크리스마스")
  const [clipartColumns, setClipartColumns] = useState<1 | 2>(2)
  const [wide, setWide] = useState(false)
  const width = panelOpen ? (wide ? 696 : 360) : 0
  // 폭이 움직이는 동안과 접힌 동안만 잘라 낸다. 펼친 채로는 패널 안 팝오버가 캔버스 쪽으로 나와야 한다
  const [moving, setMoving] = useState(false)
  const lastWidth = useRef(width)
  useLayoutEffect(() => {
    if (lastWidth.current !== width) setMoving(true)
    lastWidth.current = width
  }, [width])
  const qr = useQrBuilder({
    add,
    patch,
    selected,
    editable: !!editable,
    setMessage,
  })
  return (
    <div className="relative z-10 flex shrink-0">
      <div
        className={`relative shrink-0 transition-[width] duration-200 ease-[ease] ${moving || !panelOpen ? "overflow-hidden" : ""}`}
        style={{ width }}
        onTransitionEnd={(event) => {
          if (event.target === event.currentTarget) setMoving(false)
        }}
      >
        <aside
          data-tool-panel
          inert={!panelOpen}
          data-wide={wide || undefined}
          style={{ width: wide ? 696 : 360 }}
          className={`group/panel relative h-full border-r border-[#e0e1e5] bg-white ${inspecting ? "overflow-y-auto [&::-webkit-scrollbar]:w-5 [&::-webkit-scrollbar-thumb]:min-h-[50px] [&::-webkit-scrollbar-thumb]:rounded-[14px] [&::-webkit-scrollbar-thumb]:border-[7px] [&::-webkit-scrollbar-thumb]:border-solid [&::-webkit-scrollbar-thumb]:border-transparent [&::-webkit-scrollbar-thumb]:bg-clip-padding hover:[&::-webkit-scrollbar-thumb]:bg-[#e6e7ea] [&::-webkit-scrollbar-thumb:hover]:bg-[#222]" : `p-5 ${tool === "background" ? "overflow-visible" : "overflow-y-auto"}`}`}
        >
          {inspecting && <PropertyPanel editor={editor} />}
          {/* 선택을 풀면 메뉴가 스크롤·탭 그대로 돌아오도록 숨기기만 한다 */}
          <div hidden={inspecting}>
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
            {tool === "mywork" && <MyWorkPanel editor={editor} />}
            {tool === "draw" && <DrawPanel editor={editor} />}
          </div>
        </aside>
      </div>
      <div
        className="absolute top-1/2 z-10 flex w-[17px] -translate-y-1/2 flex-col overflow-hidden rounded-r-[150px] border border-[#e0e1e5] bg-white transition-[left] duration-200 ease-[ease]"
        style={{ left: width - 1 }}
      >
        {!wide && (
          <PanelHandle
            label={panelOpen ? "패널 접기" : "패널 펼치기"}
            direction={panelOpen ? "left" : "right"}
            tall={!panelOpen}
            onClick={() => setPanelOpen(!panelOpen)}
          />
        )}
        {panelOpen && (
          <PanelHandle
            label={wide ? "패널 좁게 보기" : "패널 넓게 보기"}
            direction={wide ? "left" : "right"}
            tall={wide}
            onClick={() => setWide(!wide)}
          />
        )}
      </div>
    </div>
  )
}

function PanelHandle({
  label,
  direction,
  tall,
  onClick,
}: {
  label: string
  direction: "left" | "right"
  tall: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`flex w-[13px] items-center justify-center text-[#9a9ca3] hover:text-[#1a1c20] ${tall ? "h-[60px]" : "h-[39px]"}`}
    >
      <svg width="4" height="7" viewBox="0 0 4 7" aria-hidden="true">
        <path
          d={
            direction === "left"
              ? "M3.5 0.5 0.5 3.5 3.5 6.5"
              : "M0.5 0.5 3.5 3.5 0.5 6.5"
          }
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
        />
      </svg>
    </button>
  )
}
