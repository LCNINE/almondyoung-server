import { useEffect, useState, type ReactNode } from "react"
import {
  Circle,
  CircleHelp,
  Eraser,
  Highlighter,
  Minus,
  MoveRight,
  PenLine,
  Shapes,
  Square,
  Triangle,
} from "lucide-react"
import {
  BRUSHES,
  type BrushKind,
  type DrawShape,
} from "../../../hooks/use-pen-tool"
import type { AlmondEditor } from "../../../hooks/use-almond-editor"
import { PrintColorPicker } from "../../color-picker"
import { GRAPHIC_ART, HAND_ART, type DrawArt } from "../../../lib/draw-art"

type Tool = BrushKind | "eraser" | "shapes"

function Tile({
  label,
  selected,
  onClick,
  children,
  className = "",
}: {
  label: string
  selected: boolean
  onClick: () => void
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`group/tile relative ${className}`}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={selected}
        onClick={onClick}
        className={`flex size-[72px] items-center justify-center rounded-[9px] border-2 ${selected ? "border-[#FEDE29] bg-white text-[#F5C400]" : "border-white bg-[#F6F7F9] text-[#70777F] hover:border-[#FEDE29] hover:bg-white hover:text-[#F5C400]"}`}
      >
        {children}
      </button>
      <span className="pointer-events-none absolute top-full left-1/2 z-10 mt-2 hidden -translate-x-1/2 rounded-[6px] bg-[#20232A] px-2 py-1 text-[13px] whitespace-nowrap text-white group-hover/tile:block">
        {label}
      </span>
    </div>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  onValue,
}: {
  label: string
  value: number
  min: number
  max: number
  onValue: (value: number) => void
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const fill = ((value - min) / (max - min)) * 100
  const commit = () => {
    const parsed = Math.round(Number(draft))
    onValue(
      Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : value
    )
  }
  return (
    <div className="border-b border-[#E6E7EA] py-3">
      <div className="flex items-center justify-between">
        <span className="text-[15px] text-[#20232A]">{label}</span>
        <input
          aria-label={`${label} 값`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => event.key === "Enter" && commit()}
          className="h-[29px] w-[50px] rounded-[5px] border border-transparent p-1.5 text-right text-[14px] text-[#3F4250] transition-[border] duration-[120ms] ease-in-out outline-none focus:border-[#E0E1E5]"
        />
      </div>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(event) => onValue(Number(event.target.value))}
        style={{
          background: `linear-gradient(to right, #4E5255 ${fill}%, #E0E1E5 ${fill}%)`,
        }}
        className="mt-2 h-[2px] w-full cursor-pointer appearance-none rounded-full [&::-moz-range-thumb]:size-[14px] [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-[#4E5255] [&::-moz-range-thumb]:bg-white [&::-webkit-slider-thumb]:size-[14px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-[#4E5255] [&::-webkit-slider-thumb]:bg-white"
      />
    </div>
  )
}

function ColorRow({
  value,
  onValue,
}: {
  value: string
  onValue: (color: string) => void
}) {
  return (
    <div className="flex h-[50px] items-center border-b border-[#E6E7EA] [&_button>span:first-child]:text-[15px] [&_button>span:first-child]:text-[#20232A]">
      <PrintColorPicker label="색상" value={value} onApply={onValue} />
    </div>
  )
}

function ShapeSection({
  title,
  help,
  children,
}: {
  title: string
  help: string
  children: ReactNode
}) {
  return (
    <section className="mt-[25px]">
      <h4 className="mb-5 flex items-center gap-[5px] text-[15px] font-normal text-[#20232A]">
        {title}
        <span className="group/help relative">
          <CircleHelp size={15} className="text-[#AAACB0]" aria-label={help} />
          <span className="pointer-events-none absolute top-1/2 left-full z-20 ml-2 hidden w-max max-w-[220px] -translate-y-1/2 rounded-[6px] bg-[rgba(42,41,47,0.95)] px-[10px] py-[7px] text-[13px] leading-[18px] font-medium text-[#F4F5F7] group-hover/help:block">
            {help}
          </span>
        </span>
      </h4>
      <div className="flex flex-wrap justify-center gap-[10px] rounded-[7px] bg-[#F6F7F9] py-5">
        {children}
      </div>
    </section>
  )
}

function ShapeTile({
  label,
  selected,
  onClick,
  children,
}: {
  label: string
  selected: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={selected}
      title={label}
      onClick={onClick}
      className={`flex size-[50px] items-center justify-center rounded-[6px] bg-white text-[#3F4250] ${selected ? "ring-1 ring-[#3F4248]" : ""}`}
    >
      {children}
    </button>
  )
}

function ArtIcon({ art }: { art: DrawArt }) {
  return (
    <svg width="28" height="28" viewBox="0 0 100 100" aria-hidden="true">
      <path
        d={art.d}
        fill={art.mode === "fill" ? "currentColor" : "none"}
        stroke={art.mode === "stroke" ? "currentColor" : "none"}
        strokeWidth={art.width ?? 7}
        strokeDasharray={art.dash}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

const BASIC_SHAPES: [DrawShape, string, typeof Circle][] = [
  ["arrow", "화살표", MoveRight],
  ["dash", "점선", Minus],
  ["circle", "원", Circle],
  ["square", "사각형", Square],
  ["triangle", "삼각형", Triangle],
]

export function DrawPanel({ editor }: { editor: AlmondEditor }) {
  const {
    pencilActive,
    eraserActive,
    shapeActive,
    shapeKind,
    chooseShape,
    shapeSetting,
    setShapeSetting,
    brushKind,
    brushes,
    setBrush,
    chooseBrush,
    chooseEraser,
    exitDrawing,
  } = editor
  const tool: Tool | null = shapeActive
    ? "shapes"
    : eraserActive
      ? "eraser"
      : pencilActive
        ? brushKind
        : null
  const setting = brushes[brushKind]
  const drawing = tool === "pen" || tool === "highlighter" || tool === "shapes"
  const stateBar = (
    <button
      type="button"
      disabled={!drawing}
      onClick={exitDrawing}
      className={`mx-auto mt-[25px] flex h-[45px] w-full items-center justify-center rounded-[7px] text-[15px] font-medium disabled:cursor-not-allowed ${drawing ? "bg-[#575A66] text-white" : "bg-[#E2E7ED] text-[#3F4250]"}`}
    >
      {drawing ? "그림 그리기 끝 (ESC)" : "도구를 선택하세요"}
    </button>
  )
  return (
    <div>
      <h3 className="text-[16px] font-normal text-[#20232A]">그리기</h3>
      <hr className="my-[15px] h-px border-0 bg-[#E6E7EA]" />
      <div className="flex gap-[9px] after:mt-[25px]">
        <Tile
          label="펜"
          selected={tool === "pen"}
          onClick={() => chooseBrush("pen")}
        >
          <PenLine size={32} strokeWidth={1.5} />
        </Tile>
        <Tile
          label="형광펜"
          selected={tool === "highlighter"}
          onClick={() => chooseBrush("highlighter")}
        >
          <Highlighter size={32} strokeWidth={1.5} />
        </Tile>
        <Tile
          label="지우개"
          selected={tool === "eraser"}
          onClick={chooseEraser}
          className="after:absolute after:top-1/2 after:-right-[11px] after:h-3/4 after:w-px after:-translate-y-1/2 after:bg-[#F6F7F9] after:transition-[height] after:duration-300"
        >
          <Eraser size={32} strokeWidth={1.5} />
        </Tile>
        <Tile
          label="선과 도형"
          selected={tool === "shapes"}
          onClick={() => chooseShape(shapeKind)}
          className="ml-[9px]"
        >
          <Shapes size={32} strokeWidth={1.5} />
        </Tile>
      </div>
      {tool !== "shapes" && stateBar}
      {(tool === "pen" || tool === "highlighter") && (
        <div className="mt-[25px] border-t border-[#E6E7EA]">
          <ColorRow
            value={setting.color}
            onValue={(color) => setBrush({ color })}
          />
          <div className="flex h-[50px] items-center justify-between border-b border-[#E6E7EA]">
            <span className="text-[15px] text-[#20232A]">선 두께 프리셋</span>
            <div className="flex gap-1">
              {BRUSHES[brushKind].presets.map((size, index) => (
                <button
                  key={size}
                  type="button"
                  aria-label={`선 두께 ${size}`}
                  aria-pressed={setting.size === size}
                  onClick={() => setBrush({ size })}
                  className={`flex size-[30px] items-center justify-center rounded-[3px] ${setting.size === size ? "border border-[#3F4248] bg-white" : "border-2 border-[#F6F7F9] bg-[#F6F7F9]"}`}
                >
                  <span
                    className="rounded-full bg-[#3F4250]"
                    style={{ width: 6 + index * 4, height: 6 + index * 4 }}
                  />
                </button>
              ))}
            </div>
          </div>
          <Slider
            label="선 두께"
            value={setting.size}
            min={1}
            max={100}
            onValue={(size) => setBrush({ size })}
          />
          <Slider
            label="불투명도"
            value={setting.opacity}
            min={0}
            max={100}
            onValue={(opacity) => setBrush({ opacity })}
          />
        </div>
      )}
      {tool === "shapes" && (
        <>
          <ShapeSection
            title="삐뚤빼뚤 손그림"
            help="가로 세로 비율을 고정한 채 사용 할 수 있습니다."
          >
            {Object.entries(HAND_ART).map(([id, art]) => (
              <ShapeTile
                key={id}
                label={art.label}
                selected={shapeKind === id}
                onClick={() => chooseShape(id as DrawShape)}
              >
                <ArtIcon art={art} />
              </ShapeTile>
            ))}
          </ShapeSection>
          <ShapeSection
            title="그리기-기본 선과 도형"
            help="선의 모양, 두께 등을 설정할 수 있습니다."
          >
            {BASIC_SHAPES.map(([id, label, Icon]) => (
              <ShapeTile
                key={id}
                label={label}
                selected={shapeKind === id}
                onClick={() => chooseShape(id)}
              >
                <Icon size={28} strokeWidth={1.5} />
              </ShapeTile>
            ))}
          </ShapeSection>
          <ShapeSection
            title="그리기-그래픽"
            help="세로 비율을 고정한 채 가로 너비를 조절하며 사용할 수 있습니다."
          >
            {Object.entries(GRAPHIC_ART).map(([id, art]) => (
              <ShapeTile
                key={id}
                label={art.label}
                selected={shapeKind === id}
                onClick={() => chooseShape(id as DrawShape)}
              >
                <ArtIcon art={art} />
              </ShapeTile>
            ))}
          </ShapeSection>
          {stateBar}
          <div className="mt-[25px] border-t border-[#E6E7EA]">
            <ColorRow
              value={shapeSetting.color}
              onValue={(color) =>
                setShapeSetting((current) => ({ ...current, color }))
              }
            />
            <Slider
              label="불투명도"
              value={shapeSetting.opacity}
              min={0}
              max={100}
              onValue={(opacity) =>
                setShapeSetting((current) => ({ ...current, opacity }))
              }
            />
          </div>
        </>
      )}
    </div>
  )
}
