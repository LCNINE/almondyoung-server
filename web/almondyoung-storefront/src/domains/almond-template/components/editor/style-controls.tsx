import { useSyncExternalStore } from "react"
import { FlipHorizontal, FlipVertical } from "lucide-react"
import type { Layer } from "../../lib/document"
import {
  fontOptions,
  fontStack,
  loadUploadedFont,
  subscribeFontOptions,
} from "../../lib/fonts"
import { PrintColorPicker } from "../color-picker"
import { bevelOf, shadowOf } from "../graphic"
import { NumberInput } from "./number-input"

// 하나를 골랐든 여럿을 골랐든 같은 컨트롤을 쓴다. apply 는 고른 요소 모두에 들어간다
export type StyleTarget = {
  layers: Layer[]
  apply: (value: Partial<Layer>) => void
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
    <div className="flex items-center gap-2">
      <span className="w-12 shrink-0">{label}</span>
      <div role="group" aria-label={label} className="flex">
        {options.map(([option, text]) => (
          <button
            key={option}
            type="button"
            aria-pressed={value === option}
            disabled={disabled}
            onClick={() => onPick(option)}
            className={`${pressed(value === option)} -ml-px first:ml-0`}
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

export function FontSelect({ target }: { target: StyleTarget }) {
  const { layers, apply, disabled } = target
  const value = common(layers, (layer) => fontStack(layer.fontFamily))
  const options = useSyncExternalStore(
    subscribeFontOptions,
    fontOptions,
    fontOptions
  )
  return (
    <label className="flex items-center gap-2">
      <span className="w-9 shrink-0">폰트</span>
      <select
        aria-label="폰트"
        className="min-w-0 flex-1 border px-2 py-1"
        value={value ?? ""}
        disabled={disabled}
        onChange={(event) => {
          const family = event.target.value
          // 고른 뒤에도 포커스가 남으면 방향키가 요소 대신 글꼴을 넘긴다
          event.target.blur()
          // 아직 안 받은 웹폰트로 재면 대체 글꼴 폭으로 상자가 맞춰진다
          ;(loadUploadedFont(family) ?? document.fonts.load(`16px ${family}`))
            .catch(() => undefined)
            .finally(() => apply({ fontFamily: family }))
        }}
      >
        {value === null && (
          <option value="" disabled>
            혼합
          </option>
        )}
        {options.map((font) => (
          <option
            key={font.value}
            value={font.value}
            style={{ fontFamily: font.value }}
          >
            {font.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export function StrokeLineControls({ target }: { target: StyleTarget }) {
  const { layers, apply, disabled } = target
  const lineOnly = layers.every((layer) => layer.type === "line")
  const round = common(layers, (layer) => !!layer.strokeRound)
  return (
    <>
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
          apply({ strokeDash: dash === "solid" ? undefined : dash })
        }
      />
      <Segmented
        label={lineOnly ? "선 끝" : "모서리"}
        options={[
          ["miter", "각지게"],
          ["round", "둥글게"],
        ]}
        value={round === null ? null : round ? "round" : "miter"}
        disabled={disabled}
        onPick={(join) => apply({ strokeRound: join === "round" || undefined })}
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
    <div className="flex items-center gap-2">
      <label className="flex items-center gap-1 whitespace-nowrap">
        꼭짓점
        <NumberInput
          aria-label="별 꼭짓점 수"
          min={3}
          max={20}
          step={1}
          className="w-12 border p-1 text-right"
          value={points}
          disabled={disabled}
          onValue={(value) =>
            apply({ starPoints: Math.round(value), starRatio: ratio })
          }
        />
      </label>
      <label className="flex min-w-0 flex-1 items-center gap-1 whitespace-nowrap">
        뾰족함
        <input
          type="range"
          aria-label="별 뾰족함"
          min={0}
          max={95}
          step={1}
          value={Math.round((1 - ratio) * 100)}
          disabled={disabled}
          onChange={(event) =>
            apply({
              starPoints: points,
              starRatio: 1 - Number(event.target.value) / 100,
            })
          }
          className="min-w-0 flex-1"
        />
      </label>
    </div>
  )
}
