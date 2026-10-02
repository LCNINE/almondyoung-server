"use client"

import { useState } from "react"
import { cmykFromHex, hexFromCmyk, validHex } from "../lib/color"

const PALETTE = [
  "ff0000 ffff00 00ff00 00ffff 0000ff ff00ff ffffff eeeeee e5e5e5 dcdcdc d2d2d2 c9c9c9 bfbfbf b5b5b5 aaaaaa a0a0a0",
  "e60012 fff100 009944 00a0e9 1d2088 e4007f 959595 898989 7d7d7d 707070 626262 535353 434343 313131 1b1b1b 000000",
  "f29a76 f6b37f facd89 fff799 cce198 acd598 89c997 84ccc9 7ecef4 88abda 8c97cb 8f82bc aa89bd c490bf f19ec2 f29c9f",
  "ec6941 f19149 facd89 fff45c b3d465 80c269 32b16c 13b5b1 00b7ee 448aca 556fb5 5f52a0 8957a1 ae5da1 ea68a2 eb6877",
  "e60012 eb6100 f39800 fff100 8fc31f 22ac38 009944 009e96 00a0e9 0068b7 00479d 1d2088 601986 920783 e4007f e5004f",
  "a40000 a84200 ac6a00 b7aa00 638c0b 097c25 007130 00736d 0075a9 004986 002e73 100964 440062 6a005f a4005b a40035",
  "7d0000 7f2d00 834e00 8a8000 486a00 005e15 00561f 005752 005982 003567 001c58 03004c 31004a 500047 7e0043 7d0022",
  "d1c0a5 a6937c 7e6b5a 59493f 362e2b cfa972 b28850 996c33 81511c 6a3906 490a3d bd1550 e97f02 f8ca00 8a9b0f 333333",
].flatMap((row) => row.split(" ").map((color) => `#${color}`))

export function PrintColorPicker({
  value,
  onApply,
  label,
  disabled = false,
  compact = false,
  placement = "left",
}: {
  value: string
  onApply: (color: string) => void
  label: string
  disabled?: boolean
  compact?: boolean
  placement?: "left" | "right"
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const cmyk = cmykFromHex(validHex(draft) ? draft : value)
  const selectColor = (color: string) => setDraft(color)

  const pickWithEyedropper = async () => {
    const Picker = (
      window as unknown as {
        EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> }
      }
    ).EyeDropper
    if (!Picker) return
    try {
      selectColor((await new Picker().open()).sRGBHex)
    } catch {
      // 취소한 경우 현재 색상을 유지한다.
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={`${label} 선택`}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          setDraft(value)
          setOpen(!open)
        }}
        className={
          compact
            ? "flex items-center gap-2 text-sm disabled:opacity-40"
            : "flex w-full items-center gap-3 border bg-white p-2 text-left text-sm disabled:opacity-40"
        }
      >
        {compact && <span>{label}</span>}
        <span
          className={compact ? "h-5 w-6 border" : "h-9 w-12 border"}
          style={{ backgroundColor: value }}
        />
        {compact ? (
          <span aria-hidden="true">▾</span>
        ) : (
          <>
            <span className="font-medium">{label}</span>
            <span className="ml-auto font-mono text-xs text-[#777]">
              {value.toUpperCase()} ▾
            </span>
          </>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={`${label} 색상 설정`}
          className={
            compact
              ? `absolute top-full z-50 mt-2 w-[280px] border bg-white p-3 shadow-lg ${placement === "right" ? "right-0" : "left-0"}`
              : "mt-2 border bg-white p-3 shadow-lg"
          }
        >
          <div className="mb-2 flex items-center justify-between text-xs">
            <strong>기본색상</strong>
            <button
              type="button"
              onClick={() => void pickWithEyedropper()}
              disabled={
                typeof window === "undefined" || !("EyeDropper" in window)
              }
              className="underline disabled:opacity-40"
            >
              스포이드
            </button>
          </div>
          <div
            className="grid gap-px"
            style={{ gridTemplateColumns: "repeat(16, minmax(0, 1fr))" }}
          >
            {PALETTE.map((color, index) => (
              <button
                key={`${color}-${index}`}
                type="button"
                aria-label={`팔레트 ${color}`}
                onClick={() => selectColor(color)}
                className={`aspect-square border border-[#ddd] ${draft.toLowerCase() === color ? "ring-2 ring-[#333] ring-inset" : ""}`}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
          <div className="mt-3 grid grid-cols-4 gap-1">
            {(["C", "M", "Y", "K"] as const).map((channel, index) => (
              <label key={channel} className="text-center text-xs">
                {channel} %
                <input
                  aria-label={`${channel} 값`}
                  type="number"
                  min="0"
                  max="100"
                  value={cmyk[index]}
                  onChange={(event) =>
                    selectColor(
                      hexFromCmyk(
                        cmyk.map((value, i) =>
                          i === index ? Number(event.target.value) : value
                        )
                      )
                    )
                  }
                  className="mt-1 w-full border p-1 text-center"
                />
              </label>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2 text-xs">
            <label htmlFor={`${label}-hex`}>#</label>
            <input
              id={`${label}-hex`}
              aria-label={`${label} HEX`}
              value={draft.replace(/^#/, "")}
              maxLength={6}
              onChange={(event) => setDraft(`#${event.target.value}`)}
              className="min-w-0 flex-1 border p-1 font-mono"
            />
            <input
              aria-label={`${label} 직접 색상 선택`}
              type="color"
              value={validHex(draft) ? draft : value}
              onInput={(event) => selectColor(event.currentTarget.value)}
              className="h-8 w-9"
            />
          </div>
          {!validHex(draft) && (
            <p className="mt-1 text-xs text-red-600">HEX 6자리를 입력하세요.</p>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="border px-3 py-1 text-xs"
            >
              취소
            </button>
            <button
              type="button"
              disabled={!validHex(draft)}
              onClick={() => {
                onApply(draft.toLowerCase())
                setOpen(false)
              }}
              className="bg-[#333] px-3 py-1 text-xs text-white disabled:opacity-40"
            >
              적용
            </button>
          </div>
          <p className="mt-2 text-[10px] text-[#888]">
            CMYK 수치는 화면용 근사값입니다.
          </p>
        </div>
      )}
    </div>
  )
}
