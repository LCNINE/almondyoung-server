import { useEffect, useRef, useState, type ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import { PrintColorPicker } from "../color-picker"
import type { Layer } from "../../lib/document"
import { pxUnit } from "../../lib/layer"
import {
  LINE_CAPS,
  LINE_DASHES,
  lineDashArray,
  lineGeometry,
  linePreset,
  lineWidth,
  type LineCap,
} from "../../lib/line-shape"
import type { AlmondEditor } from "../../hooks/use-almond-editor"
import { NumberBox, PropSection, PropSlider } from "./prop-sections"

const round2 = (value: number) => Math.round(value * 100) / 100

function CapIcon({ cap, side }: { cap: LineCap; side: "start" | "end" }) {
  const sample = {
    x: 4,
    y: 0,
    width: 17,
    height: 15,
    strokeWidth: 2,
    [side === "start" ? "lineStart" : "lineEnd"]: cap,
  }
  const { d, caps } = lineGeometry(sample)
  return (
    <svg width="25" height="15" viewBox="0 0 25 15" aria-hidden="true">
      <path d={d} stroke="#3F4250" strokeWidth={2} fill="none" />
      {caps.map((item, index) => (
        <path
          key={index}
          d={item.d}
          fill={item.filled ? "#3F4250" : "none"}
          stroke={item.stroked ? "#3F4250" : "none"}
          strokeWidth={2}
        />
      ))}
    </svg>
  )
}

function DashIcon({ dash }: { dash: [number, number] | null }) {
  return (
    <svg width="75" height="4" viewBox="0 0 75 4" aria-hidden="true">
      <path
        d="M1,2 L74,2"
        stroke="#3F4250"
        strokeWidth={2}
        strokeLinecap="square"
        strokeDasharray={
          dash
            ? lineDashArray({
                x: 0,
                y: 0,
                width: 75,
                height: 4,
                strokeWidth: 2,
                lineDash: dash,
              })
            : undefined
        }
      />
    </svg>
  )
}

// 망고보드 드롭다운: 위로 바로 펼쳐지고(애니메이션·그림자 없음) 고른 항목은 회색 바탕
function UpwardSelect<T>({
  label,
  options,
  value,
  render,
  disabled,
  onPick,
  menuWidth,
}: {
  label: string
  options: T[]
  value: T
  render: (option: T) => ReactNode
  disabled: boolean
  onPick: (option: T) => void
  menuWidth?: number
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("pointerdown", close)
    return () => document.removeEventListener("pointerdown", close)
  }, [open])
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className="flex h-[38px] w-full items-center justify-between gap-1 rounded-[6px] border border-[#e0e1e5] bg-white pr-[5px] pl-[9px] text-[13px] text-[#3F4250] disabled:opacity-40"
      >
        <span className="flex min-w-0 flex-1 items-center justify-center">
          {render(value)}
        </span>
        <ChevronDown
          size={16}
          className={`shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label={label}
          className="absolute bottom-full left-0 z-30 mb-1 rounded-[6px] border border-[#E0E1E5] bg-white p-[6px]"
          style={{ width: menuWidth ?? "100%" }}
        >
          {options.map((option, index) => (
            <li key={index}>
              <button
                type="button"
                role="option"
                aria-selected={option === value}
                onClick={() => {
                  onPick(option)
                  setOpen(false)
                }}
                className={`flex h-[38px] w-full items-center rounded-[6px] px-[10px] text-[13px] text-[#3F4250] hover:bg-[#F3F5F8] ${option === value ? "bg-[#F3F5F8]" : ""}`}
              >
                {render(option)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Radio({
  label,
  checked,
  disabled,
  onPick,
}: {
  label: string
  checked: boolean
  disabled: boolean
  onPick: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={onPick}
      className="flex items-center gap-[7px] text-[15px] text-[#3F4250]"
    >
      <span
        className={`flex size-[17px] items-center justify-center rounded-full border ${checked ? "border-[#fede29] bg-[#fede29]" : "border-[#e0e1e5] bg-white"}`}
      >
        {checked && <span className="size-[7px] rounded-full bg-white" />}
      </span>
      {label}
    </button>
  )
}

const CUSTOM = "custom" as const
type DashOption = [number, number] | null | typeof CUSTOM

// 망고보드 기본 선 속성: 선 색상 / 선 모양(직선·곡선·모서리 둥글게, 끝모양·스타일) / 머리·꼬리 크기 / 선 두께
export function LineProperties({
  editor,
  selected,
}: {
  editor: AlmondEditor
  selected: Layer
}) {
  const { patch, editable, design } = editor
  const disabled = !editable
  const unit = pxUnit(design)
  const sw = lineWidth(selected)
  const apply = (value: Partial<Layer>) => patch(selected.id, value)
  const dashOptions: DashOption[] = [...LINE_DASHES, CUSTOM]
  const currentDash: DashOption = selected.lineDashCustom
    ? CUSTOM
    : (LINE_DASHES.find(
        (dash) =>
          dash?.[0] === linePreset(selected)?.[0] &&
          dash?.[1] === linePreset(selected)?.[1]
      ) ?? null)
  const capOptions: (LineCap | undefined)[] = [...LINE_CAPS, undefined]
  const capText = (cap: LineCap | undefined, side: "start" | "end") =>
    cap ? <CapIcon cap={cap} side={side} /> : <span>없음</span>
  return (
    <>
      <PropSection className="py-5">
        <PrintColorPicker
          label="선 색상"
          value={selected.stroke ?? selected.fill}
          disabled={disabled}
          onApply={(color) => apply({ stroke: color })}
        />
      </PropSection>
      <PropSection className="space-y-[15px] py-[25px]">
        <h3 className="text-[16px] font-medium text-[#20232A]">선 모양</h3>
        <div role="radiogroup" className="flex items-center gap-5">
          <Radio
            label="직선"
            checked={!selected.lineCurved}
            disabled={disabled}
            onPick={() => apply({ lineCurved: undefined })}
          />
          <Radio
            label="곡선"
            checked={!!selected.lineCurved}
            disabled={disabled}
            onPick={() => apply({ lineCurved: true })}
          />
          <label className="ml-auto flex items-center gap-2 text-[15px] text-[#3F4250]">
            모서리 둥글게
            <input
              type="checkbox"
              checked={!!selected.strokeRound}
              disabled={disabled}
              onChange={(event) =>
                apply({ strokeRound: event.target.checked || undefined })
              }
              className="size-[17px] rounded-[4px] accent-[#fede29]"
            />
          </label>
        </div>
        <div className="grid grid-cols-[80px_1fr_80px] gap-[10px]">
          <UpwardSelect
            label="시작 끝모양"
            options={capOptions}
            value={selected.lineStart}
            render={(cap) => capText(cap, "start")}
            disabled={disabled}
            onPick={(cap) => apply({ lineStart: cap })}
          />
          <UpwardSelect
            label="선 스타일"
            options={dashOptions}
            value={currentDash}
            menuWidth={113}
            render={(dash) =>
              dash === CUSTOM ? (
                <span>사용자 지정</span>
              ) : (
                <DashIcon dash={dash} />
              )
            }
            disabled={disabled}
            onPick={(dash) =>
              apply(
                dash === CUSTOM
                  ? {
                      lineDash: undefined,
                      strokeDash: undefined,
                      lineDashCustom: [round2(10 * unit), round2(10 * unit)],
                    }
                  : {
                      lineDash: dash ?? undefined,
                      strokeDash: undefined,
                      lineDashCustom: undefined,
                    }
              )
            }
          />
          <UpwardSelect
            label="끝 끝모양"
            options={capOptions}
            value={selected.lineEnd}
            render={(cap) => capText(cap, "end")}
            disabled={disabled}
            onPick={(cap) => apply({ lineEnd: cap })}
          />
        </div>
        <div className="grid grid-cols-2 gap-[30px]">
          <PropSlider
            label="머리 크기"
            min={1}
            max={5}
            step={0.1}
            value={selected.lineStartSize ?? 1}
            disabled={disabled}
            onValue={(value) => apply({ lineStartSize: value })}
          />
          <PropSlider
            label="꼬리 크기"
            min={1}
            max={5}
            step={0.1}
            value={selected.lineEndSize ?? 1}
            disabled={disabled}
            onValue={(value) => apply({ lineEndSize: value })}
          />
        </div>
        <PropSlider
          label="선 두께"
          min={1}
          max={100}
          value={Math.max(1, Math.round(sw / unit))}
          disabled={disabled}
          onValue={(value) =>
            apply({ strokeWidth: Math.min(50, round2(value * unit)) })
          }
        />
        {selected.lineDashCustom && (
          <div className="grid grid-cols-2 gap-[30px]">
            {(["점선 길이", "점선 간격"] as const).map((label, index) => (
              <div key={label} className="flex items-center gap-2">
                <span className="text-[15px] whitespace-nowrap text-[#3F4250]">
                  {label}
                </span>
                <NumberBox
                  value={Math.round(selected.lineDashCustom![index] / unit)}
                  min={0}
                  max={500}
                  width={50}
                  unit="px"
                  disabled={disabled}
                  onValue={(value) => {
                    const next: [number, number] = [...selected.lineDashCustom!]
                    // 큰 규격에선 px 값이 검증 한도(500mm)를 넘을 수 있다
                    next[index] = Math.min(500, round2(value * unit))
                    apply({ lineDashCustom: next })
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </PropSection>
    </>
  )
}
