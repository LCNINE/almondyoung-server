import { useState, useSyncExternalStore } from "react"
import { ChevronDown, FlipHorizontal, FlipVertical } from "lucide-react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import type { Layer } from "../../lib/document"
import {
  FONT_CATEGORIES,
  type FontCategory,
  fontOptions,
  fontStack,
  loadUploadedFont,
  subscribeFontOptions,
} from "../../lib/fonts"
import { PrintColorPicker } from "../color-picker"
import { bevelOf, shadowOf, strokeRounded } from "../graphic"
import { NumberInput } from "./number-input"

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
  const { layers, apply, everywhere, disabled } = target
  const value = common(layers, (layer) => fontStack(layer.fontFamily))
  const [replaceSame, setReplaceSame] = useState(false)
  const options = useSyncExternalStore(
    subscribeFontOptions,
    fontOptions,
    fontOptions
  )
  const [open, setOpen] = useState(false)
  const [category, setCategory] = useState<FontCategory | null>(null)
  const current = options.find((font) => font.value === value)
  const categories = FONT_CATEGORIES.filter((name) =>
    options.some((font) => font.category === name)
  )
  const choose = (family: string) => {
    setOpen(false)
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
      <span className="w-9 shrink-0">폰트</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="폰트"
            disabled={disabled}
            className="flex min-w-0 flex-1 items-center justify-between gap-1 border px-2 py-1 text-left disabled:opacity-50"
          >
            <span
              className="truncate"
              style={current ? { fontFamily: current.value } : undefined}
            >
              {current?.label ?? "혼합"}
            </span>
            <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="z-[10001] w-72 p-0"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            const list = event.currentTarget as HTMLElement
            ;(
              list.querySelector<HTMLElement>('[aria-selected="true"]') ??
              list.querySelector<HTMLElement>('[role="option"]')
            )?.focus()
          }}
          // 열린 동안 누른 키는 편집기 단축키(방향키 이동·Space 화면 이동·Esc 선택 해제)로 가지 않는다
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
            event.preventDefault()
            const items = Array.from(
              event.currentTarget.querySelectorAll<HTMLElement>(
                '[role="option"]'
              )
            )
            const at = items.indexOf(document.activeElement as HTMLElement)
            items[
              Math.max(
                0,
                Math.min(
                  items.length - 1,
                  at + (event.key === "ArrowDown" ? 1 : -1)
                )
              )
            ]?.focus()
          }}
        >
          <div
            role="group"
            aria-label="폰트 분류"
            className="flex flex-wrap gap-1 border-b p-2"
          >
            {[null, ...categories].map((name) => (
              <button
                key={name ?? "전체"}
                type="button"
                aria-pressed={category === name}
                onClick={() => setCategory(name)}
                className={`rounded-full border px-2.5 py-0.5 text-xs ${category === name ? "border-foreground bg-foreground text-white" : "text-muted-foreground"}`}
              >
                {name ?? "전체"}
              </button>
            ))}
          </div>
          <ul
            role="listbox"
            aria-label="폰트 목록"
            className="max-h-72 overflow-y-auto py-1"
          >
            {options
              .filter((font) => !category || font.category === category)
              .map((font) => (
                <li key={font.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={font.value === value}
                    onClick={() => choose(font.value)}
                    className={`hover:bg-muted flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left ${font.value === value ? "bg-secondary" : ""}`}
                  >
                    <span className="truncate text-sm">{font.label}</span>
                    <span
                      className="shrink-0 text-base"
                      style={{ fontFamily: font.value }}
                      aria-hidden="true"
                    >
                      한글 Abc
                    </span>
                  </button>
                </li>
              ))}
          </ul>
          {everywhere && value && (
            <label className="flex items-center gap-1.5 border-t px-3 py-2 text-xs">
              <input
                type="checkbox"
                checked={replaceSame}
                onChange={(event) => setReplaceSame(event.target.checked)}
              />
              같은 폰트 모두 변경
            </label>
          )}
        </PopoverContent>
      </Popover>
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
            apply({ strokeDash: dash === "solid" ? undefined : dash })
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
