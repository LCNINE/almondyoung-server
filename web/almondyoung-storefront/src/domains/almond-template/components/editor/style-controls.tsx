import { useRef, useState, useSyncExternalStore } from "react"
import { ChevronDown, FlipHorizontal, FlipVertical } from "lucide-react"
import type { Layer } from "../../lib/document"
import {
  fontOptions,
  fontStack,
  loadUploadedFont,
  subscribeFontOptions,
} from "../../lib/fonts"
import { PrintColorPicker } from "../color-picker"
import { bevelOf, shadowOf, strokeRounded } from "../graphic"
import { NumberInput } from "./number-input"
import { PropSlider } from "./prop-sections"
import { FontPicker } from "./font-picker"

// 하나를 골랐든 여럿을 골랐든 같은 컨트롤을 쓴다. apply 는 고른 요소 모두에 들어간다
export type StyleTarget = {
  layers: Layer[]
  apply: (value: Partial<Layer>) => void
  everywhere?: (patchOf: (layer: Layer) => Partial<Layer>) => void
  disabled: boolean
  placement: "left" | "right"
}

// 고른 요소들의 값이 같으면 그 값, 다르면 null 이다. null 은 "혼합"으로 비워 보인다
export function common<T>(
  layers: Layer[],
  read: (layer: Layer) => T
): T | null {
  if (!layers.length) return null
  const first = read(layers[0])
  return layers.every((layer) => read(layer) === first) ? first : null
}

const pressed = (on: boolean) =>
  `border px-2 py-1 ${on ? "border-blue-600 text-blue-600" : ""}`

// 망고보드 세그먼트: 회색 트랙 안에서 고른 칸만 흰 바탕 + 노랑 테두리
function Segmented<T extends string>({
  label,
  options,
  value,
  onPick,
  disabled,
}: {
  label: string
  options: ReadonlyArray<readonly [T, string]>
  value: T | null
  onPick: (value: T) => void
  disabled: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[15px] text-[#3F4250]">{label}</span>
      <div
        role="group"
        aria-label={label}
        className="flex rounded-[7px] bg-[#e2e7ed]"
      >
        {options.map(([option, text]) => (
          <button
            key={option}
            type="button"
            aria-pressed={value === option}
            disabled={disabled}
            onClick={() => onPick(option)}
            className={`h-[34px] min-w-[56px] rounded-[7px] border-2 px-2 text-[14px] ${value === option ? "border-[#fede29] bg-white text-[#20232A]" : "border-transparent text-[#70777F]"}`}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  onValue,
  disabled,
  min,
  max,
  step,
}: {
  label: string
  value: number | null
  onValue: (value: number) => void
  disabled: boolean
  min: number
  max: number
  step: number
}) {
  return (
    <label className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[11px] text-slate-500">{label}</span>
      <NumberInput
        aria-label={label}
        className="w-full border p-1 text-right"
        placeholder={value === null ? "혼합" : undefined}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onValue={onValue}
      />
    </label>
  )
}

export function FontSelect({
  target,
  bare = false,
}: {
  target: StyleTarget
  bare?: boolean
}) {
  const { layers, apply, everywhere, disabled } = target
  const value = common(layers, (layer) => fontStack(layer.fontFamily))
  const [replaceSame, setReplaceSame] = useState(false)
  const options = useSyncExternalStore(
    subscribeFontOptions,
    fontOptions,
    fontOptions
  )
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const current = options.find((font) => font.value === value)
  const choose = (family: string) => {
    // 아직 안 받은 웹폰트로 재면 대체 글꼴 폭으로 상자가 맞춰진다
    ;(loadUploadedFont(family) ?? document.fonts.load(`16px ${family}`))
      .catch(() => undefined)
      .finally(() =>
        replaceSame && everywhere && value
          ? everywhere((layer) =>
              layer.text !== undefined && fontStack(layer.fontFamily) === value
                ? { fontFamily: family }
                : {}
            )
          : apply({ fontFamily: family })
      )
  }
  return (
    <div className="flex items-center gap-2">
      {!bare && <span className="w-9 shrink-0">폰트</span>}
      <button
        ref={trigger}
        type="button"
        aria-label="폰트"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="flex h-[38px] min-w-0 flex-1 items-center justify-between gap-1 rounded-[6px] border border-[#e0e1e5] px-[10px] text-left text-[14px] text-[#3F4250] disabled:opacity-50"
      >
        <span
          className="truncate"
          style={current ? { fontFamily: current.value } : undefined}
        >
          {current?.label ?? "혼합"}
        </span>
        <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
      </button>
      <FontPicker
        open={open}
        value={value}
        anchor={trigger.current}
        onPick={choose}
        onClose={() => setOpen(false)}
        replaceSame={replaceSame}
        onReplaceSame={everywhere && value ? setReplaceSame : undefined}
      />
    </div>
  )
}

export function StrokeLineControls({ target }: { target: StyleTarget }) {
  const { layers, apply, disabled } = target
  const lineOnly = layers.every((layer) => layer.type === "line")
  const textOnly = layers.every((layer) => layer.type === "text")
  const round = common(layers, strokeRounded)
  return (
    <>
      {!textOnly && (
        <Segmented
          label="선 모양"
          options={[
            ["solid", "실선"],
            ["dashed", "파선"],
            ["dotted", "점선"],
          ]}
          value={common(layers, (layer) => layer.strokeDash ?? "solid")}
          disabled={disabled}
          onPick={(dash) =>
            apply({
              strokeDash: dash === "solid" ? undefined : dash,
              lineDash: undefined,
              lineDashCustom: undefined,
            })
          }
        />
      )}
      <Segmented
        label={lineOnly ? "선 끝" : "모서리"}
        options={[
          ["miter", "각지게"],
          ["round", "둥글게"],
        ]}
        value={round === null ? null : round ? "round" : "miter"}
        disabled={disabled}
        onPick={(join) => apply({ strokeRound: join === "round" })}
      />
    </>
  )
}

function ShadowFields({ target }: { target: StyleTarget }) {
  const { layers, apply, disabled, placement } = target
  const read = <K extends keyof ReturnType<typeof shadowOf>>(key: K) =>
    common(layers, (layer) => shadowOf(layer)[key])
  const opacity = read("opacity")
  return (
    <div className="space-y-2 bg-slate-50 p-2">
      <div className="grid grid-cols-3 gap-2">
        <Field
          label="가로 (mm)"
          value={read("x")}
          min={-50}
          max={50}
          step={0.1}
          disabled={disabled}
          onValue={(value) => apply({ shadowX: value })}
        />
        <Field
          label="세로 (mm)"
          value={read("y")}
          min={-50}
          max={50}
          step={0.1}
          disabled={disabled}
          onValue={(value) => apply({ shadowY: value })}
        />
        <Field
          label="흐림 (mm)"
          value={read("blur")}
          min={0}
          max={20}
          step={0.1}
          disabled={disabled}
          onValue={(value) => apply({ shadowBlur: value })}
        />
      </div>
      <div className="grid grid-cols-3 items-end gap-2">
        <Field
          label="진하기 (%)"
          value={opacity === null ? null : Math.round(opacity * 100)}
          min={0}
          max={100}
          step={5}
          disabled={disabled}
          onValue={(value) => apply({ shadowOpacity: value / 100 })}
        />
        <div className="col-span-2">
          <PrintColorPicker
            label="그림자 색"
            value={read("color") ?? "#000000"}
            compact
            placement={placement}
            disabled={disabled}
            onApply={(color) => apply({ shadowColor: color })}
          />
        </div>
      </div>
    </div>
  )
}

function BevelFields({ target }: { target: StyleTarget }) {
  const { layers, apply, disabled } = target
  const read = <K extends keyof ReturnType<typeof bevelOf>>(key: K) =>
    common(layers, (layer) => bevelOf(layer)[key])
  return (
    <div className="grid grid-cols-3 gap-2 bg-slate-50 p-2">
      <Field
        label="크기 (mm)"
        value={read("size")}
        min={0.1}
        max={20}
        step={0.1}
        disabled={disabled}
        onValue={(value) => apply({ bevelSize: value })}
      />
      <Field
        label="세기 (%)"
        value={read("depth")}
        min={0}
        max={100}
        step={5}
        disabled={disabled}
        onValue={(value) => apply({ bevelDepth: value })}
      />
      <Field
        label="빛 방향 (°)"
        value={read("angle")}
        min={-360}
        max={360}
        step={15}
        disabled={disabled}
        onValue={(value) => apply({ bevelAngle: value })}
      />
    </div>
  )
}

export function EffectControls({ target }: { target: StyleTarget }) {
  const { layers, apply, disabled } = target
  const on = (field: "shadow" | "bevel" | "texture") =>
    layers.every((layer) => !!layer[field])
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="w-9 shrink-0">효과</span>
        {(
          [
            ["shadow", "그림자"],
            ["bevel", "입체"],
            ["texture", "질감"],
          ] as const
        ).map(([field, label]) => (
          <button
            key={field}
            type="button"
            aria-pressed={on(field)}
            disabled={disabled}
            onClick={() => apply({ [field]: !on(field) })}
            className={pressed(on(field))}
          >
            {label}
          </button>
        ))}
      </div>
      {on("shadow") && <ShadowFields target={target} />}
      {on("bevel") && <BevelFields target={target} />}
    </div>
  )
}

export function FlipControls({
  onFlip,
  disabled,
}: {
  onFlip: (axis: "x" | "y") => void
  disabled: boolean
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="w-9 shrink-0">반전</span>
      <button
        type="button"
        title="좌우반전 (Shift+H)"
        aria-label="좌우반전"
        disabled={disabled}
        onClick={() => onFlip("x")}
        className="p-1 hover:bg-slate-100"
      >
        <FlipHorizontal size={18} />
      </button>
      <button
        type="button"
        title="상하반전 (Shift+V)"
        aria-label="상하반전"
        disabled={disabled}
        onClick={() => onFlip("y")}
        className="p-1 hover:bg-slate-100"
      >
        <FlipVertical size={18} />
      </button>
    </div>
  )
}

export function StarControls({
  layer,
  apply,
  disabled,
}: {
  layer: Layer
  apply: (value: Partial<Layer>) => void
  disabled: boolean
}) {
  const points = layer.starPoints ?? 5
  const ratio = layer.starRatio ?? 0.38
  return (
    <div className="grid grid-cols-2 gap-[30px]">
      <PropSlider
        label="꼭짓점"
        min={3}
        max={20}
        value={points}
        disabled={disabled}
        onValue={(value) =>
          apply({ starPoints: Math.round(value), starRatio: ratio })
        }
      />
      <PropSlider
        label="뾰족함"
        min={0}
        max={95}
        value={Math.round((1 - ratio) * 100)}
        disabled={disabled}
        onValue={(value) =>
          apply({ starPoints: points, starRatio: 1 - value / 100 })
        }
      />
    </div>
  )
}
