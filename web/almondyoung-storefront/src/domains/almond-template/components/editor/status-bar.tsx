import { Ban, RotateCcw, X } from "lucide-react"
import type { AlmondEditor } from "../../hooks/use-almond-editor"
import { sideBackground } from "../../lib/document"
import { Backdrop, LayerGraphic } from "../graphic"

export function StatusBar({ editor }: { editor: AlmondEditor }) {
  const {
    variantId,
    design,
    side,
    setSide,
    hasBack,
    removedBack,
    removeBack,
    restoreBack,
    setSelectedId,
    guideMenuOpen,
    setGuideMenuOpen,
    noticeOpen,
    setNoticeOpen,
    showRuler,
    setShowRuler,
    showCutline,
    setShowCutline,
    showSafety,
    setShowSafety,
    zoom,
    zoomBy,
    zoomReset,
  } = editor
  return (
    <>
      {noticeOpen && (
        <section className="shrink-0 border-t bg-[#f7f7f7] px-5 py-4 text-xs leading-6 text-slate-600">
          <h2 className="mb-1 text-sm font-semibold text-slate-900">
            ⓘ 작업 시 유의사항
          </h2>
          <p>· 시안은 상품과 규격을 맞춰 게시해야 고객 화면에 나타납니다.</p>
          <p>
            · 다른 기기에서 이어 작업하려면 편집 JSON을 내려받아 보관하세요.
          </p>
          <p>
            · 이미지 해상도, 안전선, 재단선과 상품별 칼선을 확인하세요. EPS 시험
            출력만으로 와우프레스 접수가 보장되지는 않습니다.
          </p>
        </section>
      )}
      <div className="flex h-12 shrink-0 items-center gap-3 border-t bg-white px-4 text-sm">
        <button
          className="rounded border px-2"
          onClick={() => zoomBy(1 / 1.25)}
        >
          −
        </button>
        <button
          type="button"
          title="화면에 맞추기"
          className="w-12 text-center"
          onClick={zoomReset}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button className="rounded border px-2" onClick={() => zoomBy(1.25)}>
          +
        </button>
        <span className="mx-2 h-5 border-l" />
        {(hasBack ? (["front", "back"] as const) : (["front"] as const)).map(
          (item) => {
            const removed = item === "back" && !!removedBack
            const label = item === "front" ? "앞면" : "뒷면"
            return (
              <div key={item} className="group relative">
                <button
                  type="button"
                  aria-label={removed ? "뒷면 되살리기" : `${label} 편집`}
                  aria-pressed={side === item}
                  title={removed ? "뒷면 되살리기" : label}
                  onClick={() => {
                    if (removed) return restoreBack()
                    setSide(item)
                    setSelectedId(null)
                  }}
                  className={`relative block h-10 overflow-hidden border-2 ${side === item && !removed ? "border-[#222]" : "border-[#dcdee3]"}`}
                >
                  <svg
                    viewBox={`0 0 ${design.widthMm} ${design.heightMm}`}
                    className="h-full"
                    style={{
                      aspectRatio: `${design.widthMm} / ${design.heightMm}`,
                    }}
                  >
                    <Backdrop value={sideBackground(design, item)} />
                    {design[item]
                      .filter((layer) => layer.visible !== false)
                      .map((layer) => (
                        <LayerGraphic key={layer.id} layer={layer} />
                      ))}
                  </svg>
                  {removed && (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-white">
                      <Ban size={18} className="group-hover:hidden" />
                      <RotateCcw
                        size={18}
                        className="hidden group-hover:block"
                      />
                    </span>
                  )}
                </button>
                {item === "back" && !removed && (
                  <button
                    type="button"
                    aria-label="뒷면 없이 단면으로"
                    title="뒷면 없이 단면으로"
                    onClick={removeBack}
                    className="absolute -top-1 -right-1 flex size-4 items-center justify-center bg-[#555] text-white"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            )
          }
        )}
        <span className="mx-2 h-5 border-l" />
        <span>
          사이즈 {design.widthMm} × {design.heightMm} mm
        </span>
        {variantId && (
          <span className="ml-2 text-xs text-slate-400">옵션 선택됨</span>
        )}
        <button onClick={() => setNoticeOpen(!noticeOpen)}>
          작업 시 유의사항{" "}
          <span className="text-foreground font-semibold underline underline-offset-2">
            {noticeOpen ? "접기" : "보기"}
          </span>
        </button>
        <button
          className="ml-auto"
          onClick={() => setGuideMenuOpen(!guideMenuOpen)}
        >
          안내선 {guideMenuOpen ? "⌄" : "⌃"}
        </button>
        {guideMenuOpen && (
          <div className="absolute right-2 bottom-12 z-30 w-40 border bg-white p-3 shadow-lg">
            {(
              [
                ["눈금자", showRuler, setShowRuler],
                ["재단선", showCutline, setShowCutline],
                ["안전선", showSafety, setShowSafety],
              ] as const
            ).map(([label, checked, set]) => (
              <label key={label} className="mb-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => set(e.target.checked)}
                />
                {label}
              </label>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
