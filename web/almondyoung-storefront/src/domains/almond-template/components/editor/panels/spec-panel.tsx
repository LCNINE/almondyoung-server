import {
  PRINT_PRODUCTS,
  PRINT_SPECS,
  type PrintKind,
} from "../../../lib/catalog"
import { newDesign, resizeDesign } from "../../../lib/document"
import type { AlmondEditor } from "../../../hooks/use-almond-editor"

export function SpecPanel({ editor }: { editor: AlmondEditor }) {
  const {
    productId,
    mode,
    size,
    design,
    change,
    side,
    setSide,
    setSelectedId,
    spec,
  } = editor
  return (
    <>
      <h2 className="mb-2 font-semibold">상품과 규격</h2>
      {mode === "designer" && (
        <label className="mb-3 block text-sm">
          시안 이름
          <input
            aria-label="시안 이름"
            className="mt-1 w-full rounded border p-2"
            maxLength={50}
            value={design.title ?? ""}
            onChange={(event) =>
              change({ ...design, title: event.target.value })
            }
            placeholder="예: 여름 이벤트 초록"
          />
        </label>
      )}
      {mode === "designer" && (
        <div className="mb-3 grid grid-cols-2 gap-2 text-sm">
          <label>
            업종
            <select
              aria-label="시안 업종"
              value={design.industry ?? "미용·뷰티"}
              onChange={(event) =>
                change({ ...design, industry: event.target.value })
              }
              className="mt-1 w-full rounded border p-2"
            >
              {[
                "미용·뷰티",
                "카페·음료",
                "음식점",
                "교육",
                "병원·복지",
                "기타",
              ].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            용도
            <select
              aria-label="시안 용도"
              value={design.purpose ?? "이벤트·홍보"}
              onChange={(event) =>
                change({ ...design, purpose: event.target.value })
              }
              className="mt-1 w-full rounded border p-2"
            >
              {[
                "이벤트·홍보",
                "가격·메뉴",
                "안내·주의사항",
                "수료·증서",
                "기타",
              ].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
        </div>
      )}
      {mode === "designer" && (
        <select
          aria-label="작업 상품"
          className="mb-3 w-full rounded border p-2 text-sm"
          value={design.productId}
          disabled={!!productId}
          onChange={(event) => {
            const id = event.target.value
            const item = PRINT_PRODUCTS[id]
            change(newDesign(item?.kind ?? "pet", id))
            setSelectedId(null)
          }}
        >
          <option value="">새 시안</option>
          {Object.entries(PRINT_PRODUCTS).map(([id, item]) => (
            <option key={id} value={id}>
              {item.title}
            </option>
          ))}
        </select>
      )}
      <select
        aria-label="인쇄 유형"
        className="mb-2 w-full rounded border p-2 text-sm"
        value={design.kind}
        disabled={mode !== "designer" || !!productId}
        onChange={(event) =>
          change(newDesign(event.target.value as PrintKind, design.productId))
        }
      >
        {Object.entries(PRINT_SPECS).map(([kind, value]) => (
          <option key={kind} value={kind}>
            {value.label}
          </option>
        ))}
      </select>
      <select
        aria-label="크기"
        className="mb-2 w-full rounded border p-2 text-sm"
        value={`${design.widthMm}x${design.heightMm}`}
        disabled={!!size}
        onChange={(event) => {
          const [widthMm, heightMm] = event.target.value.split("x").map(Number)
          change(resizeDesign(design, widthMm, heightMm))
        }}
      >
        {spec.sizes.map(([w, h]) => (
          <option key={`${w}x${h}`} value={`${w}x${h}`}>
            {w} × {h} mm
          </option>
        ))}
      </select>
      <p className="mb-3 rounded bg-amber-50 p-2 text-xs leading-5 text-amber-900">
        {spec.note}
        <br />
        안전영역 {spec.safetyMm}mm · 재단 여유 {spec.bleedMm}mm · 이미지{" "}
        {spec.minImageDpi}dpi
        {(["pet", "mini", "window"] as PrintKind[]).includes(design.kind) && (
          <> · 파일 축척 1:{Math.round(1 / spec.fileScale)}</>
        )}
      </p>
      <div className="mb-3 flex gap-2">
        <button
          className={`flex-1 rounded p-2 ${side === "front" ? "bg-slate-900 text-white" : "border"}`}
          onClick={() => {
            setSide("front")
            setSelectedId(null)
          }}
        >
          앞면
        </button>
        <button
          className={`flex-1 rounded p-2 ${side === "back" ? "bg-slate-900 text-white" : "border"}`}
          onClick={() => {
            setSide("back")
            setSelectedId(null)
          }}
        >
          뒷면
        </button>
      </div>
    </>
  )
}
