import { useEffect, useState, type ReactNode } from "react"
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  FlipHorizontal,
  FlipVertical,
} from "lucide-react"
import type { AlmondEditor } from "../../hooks/use-almond-editor"
import { layerBounds } from "../../lib/canvas-math"
import type { Layer } from "../../lib/document"
import { mm } from "../../lib/layer"
import { OrderIcon } from "./order-icon"
import { PrintColorPicker } from "../color-picker"
import { bevelOf, shadowOf } from "../graphic"
import { common, type StyleTarget } from "./style-controls"

// 망고보드 속성 패널 부품. 섹션은 아래 1px #e6e7ea 선으로 나뉜다

export function PropHeader({
  title,
  children,
}: {
  title: string
  children?: ReactNode
}) {
  return (
    <div className="flex h-[60px] items-center border-b border-[#e6e7ea] px-[13px]">
      <h2 className="mr-[5px] text-[16px] font-medium text-[#20232A]">
        {title}
      </h2>
      <div className="ml-auto flex items-center">{children}</div>
    </div>
  )
}

export function PropSection({
  children,
  className = "",
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={`border-b border-[#e6e7ea] px-[3px] pl-[13px] ${className}`}
    >
      {children}
    </section>
  )
}

export function IconButton33({
  label,
  onClick,
  disabled = false,
  pressed,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  pressed?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`flex size-[33px] items-center justify-center rounded-[6px] text-[#3F4250] hover:bg-[#F3F5F8] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent ${pressed ? "bg-[#e2e7ed]" : ""}`}
    >
      {children}
    </button>
  )
}

// 정렬(종이 기준) 6개 · 간격 동일 2개(하나일 땐 비활성) / 순서 4개 · 뒤집기 2개
export function AlignOrderSection({
  editor,
  layer,
  canFlip = true,
}: {
  editor: AlmondEditor
  layer: Layer
  canFlip?: boolean
}) {
  const { design, patch, editable, setOrder, flipLayers } = editor
  const align = (
    kind: "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom"
  ) => {
    const box = layerBounds(layer)
    const dx =
      kind === "left"
        ? -box.x0
        : kind === "right"
          ? design.widthMm - box.x1
          : kind === "hcenter"
            ? design.widthMm / 2 - (box.x0 + box.x1) / 2
            : 0
    const dy =
      kind === "top"
        ? -box.y0
        : kind === "bottom"
          ? design.heightMm - box.y1
          : kind === "vcenter"
            ? design.heightMm / 2 - (box.y0 + box.y1) / 2
            : 0
    patch(layer.id, { x: mm(layer.x + dx), y: mm(layer.y + dy) })
  }
  const aligns = [
    ["left", "왼쪽 정렬", AlignStartVertical],
    ["hcenter", "가로 가운데 정렬", AlignCenterVertical],
    ["right", "오른쪽 정렬", AlignEndVertical],
    ["top", "위쪽 정렬", AlignStartHorizontal],
    ["vcenter", "세로 가운데 정렬", AlignCenterHorizontal],
    ["bottom", "아래쪽 정렬", AlignEndHorizontal],
  ] as const
  return (
    <PropSection className="py-[17px]">
      <div className="flex flex-wrap gap-x-[5px] gap-y-1">
        {aligns.map(([kind, label, Icon]) => (
          <IconButton33
            key={kind}
            label={label}
            disabled={!editable}
            onClick={() => align(kind)}
          >
            <Icon size={20} strokeWidth={1.6} />
          </IconButton33>
        ))}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-[5px]">
        {(
          [
            ["top", "맨 앞으로"],
            ["up", "앞으로"],
            ["down", "뒤로"],
            ["bottom", "맨 뒤로"],
          ] as const
        ).map(([position, label]) => (
          <IconButton33
            key={position}
            label={label}
            disabled={!editable}
            onClick={() => setOrder(position)}
          >
            <OrderIcon position={position} />
          </IconButton33>
        ))}
        <IconButton33
          label="좌우 반전"
          disabled={!editable || !canFlip}
          onClick={() => flipLayers([layer], "x")}
        >
          <FlipHorizontal size={20} strokeWidth={1.6} />
        </IconButton33>
        <IconButton33
          label="상하 반전"
          disabled={!editable || !canFlip}
          onClick={() => flipLayers([layer], "y")}
        >
          <FlipVertical size={20} strokeWidth={1.6} />
        </IconButton33>
      </div>
    </PropSection>
  )
}

export function NumberBox({
  label,
  value,
  unit,
  disabled = false,
  min,
  max,
  step = 1,
  onValue,
  width = 82,
}: {
  label?: string
  value: number
  unit?: string
  disabled?: boolean
  min?: number
  max?: number
  step?: number
  onValue: (value: number) => void
  width?: number
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = (raw: string) => {
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return setDraft(String(value))
    const clamped = Math.max(
      min ?? -Infinity,
      Math.min(max ?? Infinity, parsed)
    )
    onValue(clamped)
  }
  const nudge = (delta: number) =>
    commit(String(Math.round((value + delta) * 100) / 100))
  return (
    <label className="flex flex-col gap-[5px]">
      {label && (
        <span className="h-4 text-[13px] leading-4 text-[#70777F]">
          {label}
        </span>
      )}
      <span className="flex items-center gap-1">
        <span className="relative" style={{ width }}>
          <input
            aria-label={label}
            value={draft}
            disabled={disabled}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={(event) => commit(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") commit(event.currentTarget.value)
              if (event.key === "ArrowUp") {
                event.preventDefault()
                nudge(step)
              }
              if (event.key === "ArrowDown") {
                event.preventDefault()
                nudge(-step)
              }
            }}
            className="h-[38px] w-full rounded-[6px] border border-[#e0e1e5] p-[10px] pr-6 text-[14px] text-[#3F4250] transition-[border] duration-[120ms] ease-in-out outline-none disabled:bg-[#f6f7f9] disabled:text-[#AAACB0]"
          />
          {!disabled && (
            <span className="absolute top-0 right-0 flex h-full w-6 flex-col">
              <button
                type="button"
                tabIndex={-1}
                aria-label={`${label ?? ""} 올리기`}
                onClick={() => nudge(step)}
                className="flex h-[19px] items-center justify-center text-[#70777F]"
              >
                <svg width="7" height="4" viewBox="0 0 7 4" aria-hidden="true">
                  <path d="M0 4 3.5 0 7 4z" fill="currentColor" />
                </svg>
              </button>
              <button
                type="button"
                tabIndex={-1}
                aria-label={`${label ?? ""} 내리기`}
                onClick={() => nudge(-step)}
                className="flex h-[19px] items-center justify-center text-[#70777F]"
              >
                <svg width="7" height="4" viewBox="0 0 7 4" aria-hidden="true">
                  <path d="M0 0h7L3.5 4z" fill="currentColor" />
                </svg>
              </button>
            </span>
          )}
        </span>
        {unit && <span className="text-[14px] text-[#70777F]">{unit}</span>}
      </span>
    </label>
  )
}

export function SizeSection({
  editor,
  layer,
  heightLocked = false,
}: {
  editor: AlmondEditor
  layer: Layer
  heightLocked?: boolean
}) {
  const { setGeometry, patch, editable } = editor
  return (
    <PropSection className="flex items-end gap-[10px] py-5">
      <NumberBox
        label="너비"
        value={layer.width}
        step={0.5}
        disabled={!editable}
        onValue={(value) => setGeometry("width", value)}
      />
      <NumberBox
        label="높이"
        value={layer.height}
        step={0.5}
        disabled={!editable || heightLocked}
        onValue={(value) => setGeometry("height", value)}
      />
      <NumberBox
        label="회전"
        value={layer.rotation ?? 0}
        min={-360}
        max={360}
        disabled={!editable}
        onValue={(value) => patch(layer.id, { rotation: value })}
        width={70}
      />
      <span className="pb-[10px] text-[14px] text-[#70777F]">mm</span>
    </PropSection>
  )
}

export function PropSlider({
  label,
  value,
  min,
  max,
  step = 1,
  disabled = false,
  onValue,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  disabled?: boolean
  onValue: (value: number) => void
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const fill = ((Math.max(min, Math.min(max, value)) - min) / (max - min)) * 100
  const commit = () => {
    const parsed = Number(draft)
    onValue(
      Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : value
    )
  }
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-[15px] text-[#3F4250]">{label}</span>
        <input
          aria-label={`${label} 값`}
          value={draft}
          disabled={disabled}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => event.key === "Enter" && commit()}
          className="h-[29px] w-[50px] rounded-[5px] border border-transparent p-1.5 text-right text-[14px] text-[#3F4250] transition-[border] duration-[120ms] ease-in-out outline-none focus:border-[#e0e1e5]"
        />
      </div>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onValue(Number(event.target.value))}
        style={{
          background: `linear-gradient(to right, #4E5255 ${fill}%, #E0E1E5 ${fill}%)`,
        }}
        className="mt-2 h-[2px] w-full cursor-pointer appearance-none rounded-full disabled:cursor-not-allowed [&::-moz-range-thumb]:size-[14px] [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-[#4E5255] [&::-moz-range-thumb]:bg-white [&::-webkit-slider-thumb]:size-[14px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-[#4E5255] [&::-webkit-slider-thumb]:bg-white"
      />
    </div>
  )
}

// 망고보드 토글: 38x21, 켜지면 노랑
export function Toggle({
  label,
  checked,
  disabled = false,
  onChange,
}: {
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex h-[34px] items-center justify-between">
      <span className="text-[15px] text-[#3F4250]">{label}</span>
      <button
        type="button"
        role="switch"
        aria-label={label}
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-[21px] w-[38px] rounded-full transition-colors duration-300 disabled:opacity-40 ${checked ? "bg-[#fede29]" : "bg-[#E0E1E5]"}`}
      >
        <span
          className={`absolute top-[5px] size-3 rounded-full bg-white transition-all duration-300 ${checked ? "left-[21px]" : "left-[5px]"}`}
        />
      </button>
    </label>
  )
}

// 망고보드 아코디언 안쪽 박스: 「OO 설정」 + 해제 밑줄 링크
export function SettingBox({
  title,
  onClear,
  disabled = false,
  children,
}: {
  title: string
  onClear: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <div className="mt-[15px] space-y-[15px] rounded-[7px] bg-[#f6f7f9] px-[15px] py-5">
      <div className="flex items-center justify-between">
        <span className="text-[15px] text-[#20232A]">{title}</span>
        <button
          type="button"
          disabled={disabled}
          onClick={onClear}
          className="text-[15px] text-[#3F4250] underline"
        >
          해제
        </button>
      </div>
      {children}
    </div>
  )
}

// 그림자 행: 스와치로 색을 고르면 켜지고 설정 박스가 펼쳐진다. 값은 1080px 화면 기준 px 로 보이고 mm 로 저장한다
export function ShadowRow({
  target,
  unit,
}: {
  target: StyleTarget
  unit: number
}) {
  const { layers, apply, disabled } = target
  const on = layers.every((layer) => !!layer.shadow)
  const read = <K extends keyof ReturnType<typeof shadowOf>>(key: K) =>
    common(layers, (layer) => shadowOf(layer)[key])
  const px = (value: number | null) =>
    value === null ? 0 : Math.round(value / unit)
  const opacity = read("opacity")
  return (
    <div>
      <PrintColorPicker
        label="그림자"
        value={on ? (read("color") ?? "#000000") : "none"}
        disabled={disabled}
        onClear={() => apply({ shadow: false })}
        onApply={(color) =>
          apply(
            on
              ? { shadowColor: color }
              : {
                  shadow: true,
                  shadowColor: color,
                  shadowX: Math.round(5 * unit * 100) / 100,
                  shadowY: Math.round(5 * unit * 100) / 100,
                  shadowBlur: Math.round(5 * unit * 100) / 100,
                  shadowOpacity: 0.5,
                }
          )
        }
      />
      <div
        className={`grid transition-[grid-template-rows] duration-300 ${on ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
      >
        <div className="overflow-hidden">
          <SettingBox
            title="그림자 설정"
            disabled={disabled}
            onClear={() => apply({ shadow: false })}
          >
            <div className="flex items-end gap-[10px]">
              {(
                [
                  ["x", "가로", "shadowX", -50, 50],
                  ["y", "세로", "shadowY", -50, 50],
                  ["blur", "블러", "shadowBlur", 0, 20],
                ] as const
              ).map(([key, label, field, min, max]) => (
                <NumberBox
                  key={key}
                  label={label}
                  value={px(read(key))}
                  width={73}
                  disabled={disabled}
                  onValue={(value) =>
                    apply({
                      [field]: Math.max(
                        min,
                        Math.min(max, Math.round(value * unit * 100) / 100)
                      ),
                    })
                  }
                />
              ))}
              <span className="pb-[10px] text-[14px] text-[#70777F]">px</span>
            </div>
            <PropSlider
              label="그림자 불투명도"
              min={0}
              max={100}
              value={opacity === null ? 0 : Math.round(opacity * 100)}
              disabled={disabled}
              onValue={(value) => apply({ shadowOpacity: value / 100 })}
            />
          </SettingBox>
        </div>
      </div>
    </div>
  )
}

// 입체·질감은 망고보드에 없는 인쇄용 효과라 토글 행으로 둔다
export function PrintEffectRows({ target }: { target: StyleTarget }) {
  const { layers, apply, disabled } = target
  const on = (field: "bevel" | "texture") =>
    layers.every((layer) => !!layer[field])
  const bevel = <K extends keyof ReturnType<typeof bevelOf>>(key: K) =>
    common(layers, (layer) => bevelOf(layer)[key]) ?? 0
  return (
    <>
      <Toggle
        label="입체"
        checked={on("bevel")}
        disabled={disabled}
        onChange={(checked) => apply({ bevel: checked })}
      />
      {on("bevel") && (
        <SettingBox
          title="입체 설정"
          disabled={disabled}
          onClear={() => apply({ bevel: false })}
        >
          <PropSlider
            label="크기"
            min={0.1}
            max={20}
            step={0.1}
            value={bevel("size")}
            disabled={disabled}
            onValue={(value) => apply({ bevelSize: value })}
          />
          <PropSlider
            label="세기"
            min={0}
            max={100}
            value={bevel("depth")}
            disabled={disabled}
            onValue={(value) => apply({ bevelDepth: value })}
          />
          <PropSlider
            label="빛 방향"
            min={-180}
            max={180}
            step={15}
            value={bevel("angle")}
            disabled={disabled}
            onValue={(value) => apply({ bevelAngle: value })}
          />
        </SettingBox>
      )}
      <Toggle
        label="질감"
        checked={on("texture")}
        disabled={disabled}
        onChange={(checked) => apply({ texture: checked })}
      />
    </>
  )
}

export function OpacitySection({
  value,
  disabled,
  onValue,
}: {
  value: number | undefined
  disabled: boolean
  onValue: (opacity: number) => void
}) {
  return (
    <PropSection className="py-5">
      <PropSlider
        label="불투명도"
        min={10}
        max={100}
        value={Math.round((value ?? 1) * 100)}
        disabled={disabled}
        onValue={(percent) =>
          onValue(Math.max(0.1, Math.min(1, percent / 100)))
        }
      />
    </PropSection>
  )
}
