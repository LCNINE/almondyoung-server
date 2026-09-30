import type { AlmondEditor } from "../../hooks/use-almond-editor"

export function StatusBar({ editor }: { editor: AlmondEditor }) {
  const {
    variantId,
    design,
    side,
    setSide,
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
    setZoom,
  } = editor
  return (
    <>
      {noticeOpen && (
        <section className="shrink-0 border-t bg-[#f7f7f7] px-5 py-4 text-xs leading-6 text-slate-600">
          <h2 className="mb-1 text-sm font-semibold text-slate-900">
            ⓘ 작업 시 유의사항
          </h2>
          <p>
            · 인턴 시안은 상품과 규격을 맞춰 게시해야 고객 화면에 나타납니다.
          </p>
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
          onClick={() => setZoom(Math.max(0.4, zoom - 0.2))}
        >
          −
        </button>
        <span className="w-12 text-center">{Math.round(zoom * 100)}%</span>
        <button
          className="rounded border px-2"
          onClick={() => setZoom(Math.min(2, zoom + 0.2))}
        >
          +
        </button>
        <span className="mx-2 h-5 border-l" />
        <button
          className={side === "front" ? "font-semibold" : "text-slate-400"}
          onClick={() => {
            setSide("front")
            setSelectedId(null)
          }}
        >
          앞면
        </button>
        <button
          className={side === "back" ? "font-semibold" : "text-slate-400"}
          onClick={() => {
            setSide("back")
            setSelectedId(null)
          }}
        >
          뒷면
        </button>
        <span className="mx-2 h-5 border-l" />
        <span>
          사이즈 {design.widthMm} × {design.heightMm} mm
        </span>
        {variantId && (
          <span className="ml-2 text-xs text-slate-400">옵션 선택됨</span>
        )}
        <button onClick={() => setNoticeOpen(!noticeOpen)}>
          작업 시 유의사항 {noticeOpen ? "접기" : "보기"}
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
