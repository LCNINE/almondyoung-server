"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Pipette } from "lucide-react"
import { cmykFromHex, hexFromCmyk, validHex } from "../lib/color"

// 망고보드 컬러피커 「기본」 탭 40색(8열×5행)
const BASIC = [
  "#ffffff #ffc2c2 #ffcc99 #fff3c8 #dee6c3 #d1eff0 #daeefa #f0e7ef",
  "#d3d3d3 #ef4d4d #ff9750 #f2db68 #c5db91 #a4dcde #86c1e0 #af8bb7",
  "#777777 #bf4141 #dd5e17 #ffb808 #6cb77e #519c90 #4181a1 #554475",
  "#333333 #822525 #994900 #cc9933 #49663c #294743 #1f274d #645b75",
  "#000000 #4e2c2c #4d2500 #987837 #373736 #1b201f #181c2c #302643",
].flatMap((row) => row.split(" "))

const THEMES: [string, string[]][] = [
  [
    "사계절",
    ["#f6c6d0", "#f9e79f", "#a9dfbf", "#f5b041", "#aed6f1", "#ffffff"],
  ],
  [
    "여름 바다",
    ["#0b3c5d", "#328cc1", "#7ec8e3", "#d9f1ff", "#f4e1b6", "#ffffff"],
  ],
  [
    "감각적 인테리어",
    ["#2d2a26", "#7a6a58", "#c9b79c", "#e8e1d5", "#a3b18a", "#588157"],
  ],
  [
    "따뜻한 카페",
    ["#4b2e2b", "#8c5a3c", "#c08552", "#f3e9dc", "#dab49d", "#ffffff"],
  ],
  [
    "뷰티 살롱",
    ["#3d2b3d", "#c67b9a", "#f2c4ce", "#fbe8ec", "#e0b1cb", "#ffffff"],
  ],
  [
    "모노톤",
    ["#000000", "#333333", "#666666", "#999999", "#cccccc", "#ffffff"],
  ],
]

const TABS = ["기본", "테마", "사용한 색상", "내 팔레트", "직접지정"] as const

// 사용한 색은 편집 중에만 기억한다. 내 팔레트는 이 브라우저에만 둔다
let recent: string[] = []
const PALETTE_KEY = "almond-template:my-palette"
function readPalette(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(PALETTE_KEY) ?? "[]")
    return Array.isArray(value) ? value.filter(validHex) : []
  } catch {
    return []
  }
}
function writePalette(colors: string[]) {
  try {
    localStorage.setItem(PALETTE_KEY, JSON.stringify(colors))
  } catch {
    // 저장소를 못 쓰면 이번 화면에서만 쓴다
  }
}

function hsvFromHex(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map(
    (i) => parseInt(hex.slice(i, i + 2), 16) / 255
  )
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  const h = !d
    ? 0
    : max === r
      ? ((g - b) / d + 6) % 6
      : max === g
        ? (b - r) / d + 2
        : (r - g) / d + 4
  return [h * 60, max ? d / max : 0, max]
}

function hexFromHsv(h: number, s: number, v: number) {
  const f = (n: number) => {
    const k = (n + h / 60) % 6
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1))
  }
  return `#${[f(5), f(3), f(1)]
    .map((c) =>
      Math.round(c * 255)
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`
}

function Swatch({
  color,
  selected,
  onPick,
}: {
  color: string
  selected: boolean
  onPick: (color: string) => void
}) {
  return (
    <button
      type="button"
      aria-label={`팔레트 ${color}`}
      onClick={() => onPick(color)}
      className={`group/sw relative size-[33px] rounded-[4px] border border-[#e0e1e5] hover:outline hover:outline-1 hover:outline-[rgba(0,0,0,0.1)] ${selected ? "ring-1 ring-[#20232A] ring-offset-1" : ""}`}
      style={{ backgroundColor: color }}
    >
      <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded-[6px] bg-[rgba(42,41,47,0.95)] px-2 py-1 text-[12px] text-[#F4F5F7] group-hover/sw:block">
        {color}
      </span>
    </button>
  )
}

function CustomTab({
  value,
  onPick,
}: {
  value: string
  onPick: (color: string) => void
}) {
  const [before] = useState(value)
  const safe = validHex(value) ? value : "#000000"
  const [h, s, v] = hsvFromHex(safe)
  const [hue, setHue] = useState(h)
  const cmyk = cmykFromHex(safe)
  const drag = (
    event: React.PointerEvent<HTMLDivElement>,
    apply: (x: number, y: number) => void
  ) => {
    const target = event.currentTarget
    const move = (e: { clientX: number; clientY: number }) => {
      const rect = target.getBoundingClientRect()
      apply(
        Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
        Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
      )
    }
    move(event)
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }
  return (
    <div className="px-5 pt-5">
      <div
        className="relative h-3 w-[200px] cursor-pointer rounded-[6px]"
        style={{
          background:
            "linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)",
        }}
        onPointerDown={(event) =>
          drag(event, (x) => {
            setHue(x * 360)
            onPick(hexFromHsv(x * 360, s, v))
          })
        }
      >
        <span
          className="absolute top-1/2 size-[14px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[3px_3px_5px_rgba(0,0,0,0.2)]"
          style={{ left: `${(hue / 360) * 100}%` }}
        />
      </div>
      <div className="mt-4 flex gap-4">
        <div
          className="relative size-[200px] shrink-0 cursor-crosshair rounded-[7px]"
          style={{
            background: `linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,transparent),${hexFromHsv(hue, 1, 1)}`,
          }}
          onPointerDown={(event) =>
            drag(event, (x, y) => onPick(hexFromHsv(hue, x, 1 - y)))
          }
        >
          <span
            className="absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[rgba(0,0,0,0.1)] ring-2 ring-white"
            style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%` }}
          />
        </div>
        <div className="text-[12px] text-[#70777F]">
          <div className="flex">
            <span
              className="size-[33px] rounded-l-[4px] border border-[#e0e1e5]"
              style={{ backgroundColor: before }}
            />
            <span
              className="size-[33px] rounded-r-[4px] border border-l-0 border-[#e0e1e5]"
              style={{ backgroundColor: value }}
            />
          </div>
          <div className="mt-1 flex justify-between">
            <span>이전</span>
            <span>현재</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-1">
            {(["C", "M", "Y", "K"] as const).map((channel, index) => (
              <label key={channel} className="text-center">
                {channel}
                <input
                  aria-label={`${channel} 값`}
                  type="number"
                  min="0"
                  max="100"
                  value={cmyk[index]}
                  onChange={(event) =>
                    onPick(
                      hexFromCmyk(
                        cmyk.map((c, i) =>
                          i === index ? Number(event.target.value) : c
                        )
                      )
                    )
                  }
                  className="mt-0.5 w-full rounded-[4px] border border-[#e0e1e5] p-1 text-center text-[12px] text-[#3F4250]"
                />
              </label>
            ))}
          </div>
          <p className="mt-1 text-[10px] text-[#AAACB0]">CMYK 는 근사값</p>
        </div>
      </div>
    </div>
  )
}

export function PrintColorPicker({
  value,
  onApply,
  onApplyEverywhere,
  label,
  disabled = false,
  compact = false,
}: {
  value: string
  onApply: (color: string) => void
  onApplyEverywhere?: (color: string) => void
  instant?: boolean
  label: string
  disabled?: boolean
  compact?: boolean
  placement?: "left" | "right"
}) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<(typeof TABS)[number]>("기본")
  const [hex, setHex] = useState(value)
  const [everywhere, setEverywhere] = useState(false)
  const [palette, setPalette] = useState<string[]>([])
  const [at, setAt] = useState({ left: 0, top: 0 })
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => setHex(value), [value])
  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      const target = event.target as Node
      if (
        !panel.current?.contains(target) &&
        !trigger.current?.contains(target)
      )
        setOpen(false)
    }
    document.addEventListener("pointerdown", close)
    return () => document.removeEventListener("pointerdown", close)
  }, [open])
  // 망고보드처럼 속성 패널 오른쪽 바깥에 붙인다. 패널이 없는 곳(펜 막대)은 버튼 아래
  const place = () => {
    const rect = trigger.current!.getBoundingClientRect()
    const side = trigger.current!.closest("aside")?.getBoundingClientRect()
    const top = side ? rect.top - 290 : rect.bottom + 8
    setAt({
      left: side ? side.right + 9 : rect.left,
      top: Math.max(66, Math.min(top, window.innerHeight - 490)),
    })
  }
  const pick = (color: string) => {
    const next = color.toLowerCase()
    setHex(next)
    recent = [next, ...recent.filter((c) => c !== next)].slice(0, 16)
    if (everywhere && onApplyEverywhere) onApplyEverywhere(next)
    else onApply(next)
  }
  const pickWithEyedropper = async () => {
    const Picker = (
      window as unknown as {
        EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> }
      }
    ).EyeDropper
    if (!Picker) return
    try {
      pick((await new Picker().open()).sRGBHex)
    } catch {
      // 취소한 경우 현재 색상을 유지한다.
    }
  }
  return (
    <div className={compact ? "inline-flex" : "w-full"}>
      <button
        ref={trigger}
        type="button"
        aria-label={`${label} 선택`}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          if (!open) {
            place()
            setPalette(readPalette())
          }
          setOpen(!open)
        }}
        className={
          compact
            ? "flex items-center gap-2 text-sm disabled:opacity-40"
            : "flex w-full items-center justify-between text-[15px] text-[#3F4250] disabled:opacity-40"
        }
      >
        <span>{label}</span>
        <span className="rounded-[3px] border border-[#e0e1e5] p-[2px]">
          <span
            className={`block rounded-[4px] ${compact ? "size-[24px]" : "size-[30px]"}`}
            style={{ backgroundColor: value }}
          />
        </span>
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            role="dialog"
            aria-label={`${label} 색상 설정`}
            className="fixed z-[10003] w-[352px] rounded-[14px] border border-[#e0e1e5] bg-white text-[#20232A]"
            style={at}
          >
            <div className="flex h-[61px] items-center gap-2 border-b border-[#e6e7ea] px-[19px] py-[13px]">
              <span
                className="size-[25px] shrink-0 rounded-[3px] border border-[#e0e1e5]"
                style={{ backgroundColor: value }}
              />
              <input
                aria-label={`${label} HEX`}
                value={hex}
                onChange={(event) => {
                  setHex(event.target.value)
                  if (validHex(event.target.value)) pick(event.target.value)
                }}
                className="h-[29px] w-[101px] text-[14px] text-[#3F4250] outline-none"
              />
              <button
                type="button"
                aria-label="스포이드"
                title="스포이드"
                onClick={() => void pickWithEyedropper()}
                disabled={
                  typeof window === "undefined" || !("EyeDropper" in window)
                }
                className="flex size-[34px] shrink-0 items-center justify-center rounded-[5px] bg-[#f3f5f8] text-[#3F4250] disabled:opacity-40"
              >
                <Pipette size={16} />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!validHex(value) || palette.includes(value)) return
                  const next = [...palette, value]
                  setPalette(next)
                  writePalette(next)
                }}
                className="ml-auto h-[34px] shrink-0 rounded-[5px] border border-[#e0e1e5] px-3 text-[13px] text-[#3F4250]"
              >
                내 팔레트에 저장
              </button>
            </div>
            <div className="flex border-b border-[#e6e7ea] px-[10px]">
              {TABS.map((name) => (
                <button
                  key={name}
                  type="button"
                  aria-pressed={tab === name}
                  onClick={() => setTab(name)}
                  className={`relative px-[10px] pt-[10px] pb-[14px] text-[13px] whitespace-nowrap ${tab === name ? "font-semibold text-[#20232A] after:absolute after:right-[10px] after:bottom-0 after:left-[10px] after:h-[3px] after:bg-[#3f4250]" : "text-[#70777F]"}`}
                >
                  {name}
                </button>
              ))}
            </div>
            <div className="h-[278px] overflow-y-auto">
              {tab === "기본" && (
                <div className="grid grid-cols-8 gap-[6px] pt-5 pl-5">
                  {BASIC.map((color) => (
                    <Swatch
                      key={color}
                      color={color}
                      selected={value.toLowerCase() === color}
                      onPick={pick}
                    />
                  ))}
                </div>
              )}
              {tab === "테마" && (
                <ul className="space-y-4 px-5 pt-5">
                  {THEMES.map(([name, colors]) => (
                    <li key={name}>
                      <p className="mb-1.5 text-[13px] text-[#3F4250]">
                        {name}
                      </p>
                      <div className="flex gap-[6px]">
                        {colors.map((color) => (
                          <Swatch
                            key={color}
                            color={color}
                            selected={value.toLowerCase() === color}
                            onPick={pick}
                          />
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {tab === "사용한 색상" && (
                <div className="px-5 pt-5">
                  {recent.length ? (
                    <div className="grid grid-cols-8 gap-[6px]">
                      {recent.map((color) => (
                        <Swatch
                          key={color}
                          color={color}
                          selected={value.toLowerCase() === color}
                          onPick={pick}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="text-[13px] text-[#70777F]">
                      아직 사용한 색상이 없습니다.
                    </p>
                  )}
                </div>
              )}
              {tab === "내 팔레트" && (
                <div className="px-5 pt-5">
                  {palette.length ? (
                    <div className="grid grid-cols-8 gap-[6px]">
                      {palette.map((color) => (
                        <Swatch
                          key={color}
                          color={color}
                          selected={value.toLowerCase() === color}
                          onPick={pick}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="text-[13px] leading-5 text-[#70777F]">
                      내 팔레트가 없습니다. 위의 「내 팔레트에 저장」을 눌러
                      지금 색을 담아 보세요.
                    </p>
                  )}
                </div>
              )}
              {tab === "직접지정" && <CustomTab value={value} onPick={pick} />}
            </div>
            <div className="flex h-[70px] items-center border-t border-[#e6e7ea] px-[19px] py-5">
              {onApplyEverywhere && (
                <label className="flex items-center gap-2 text-[14px] text-[#3F4250]">
                  <input
                    type="checkbox"
                    checked={everywhere}
                    onChange={(event) => setEverywhere(event.target.checked)}
                    className="size-[23px] rounded-[5px] accent-[#fede29]"
                  />
                  같은 색상 모두 변경
                </label>
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}
