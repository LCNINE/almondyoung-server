import { useState } from "react"
import { PRINT_PRODUCTS, PRINT_SPECS } from "../../../lib/catalog"
import type { PublishedTemplate } from "../../../lib/gallery-filter"
import type { AlmondEditor } from "../../../hooks/use-almond-editor"

export function TemplatePanel({
  editor,
  templateSearch,
  setTemplateSearch,
}: {
  editor: AlmondEditor
  templateSearch: string
  setTemplateSearch: (value: string) => void
}) {
  const {
    design,
    productId,
    mode,
    publishedTemplates,
    loadPublished,
    applyStarter,
  } = editor
  const [previewing, setPreviewing] = useState<{
    item: PublishedTemplate
    top: number
    left: number
  } | null>(null)
  const [applying, setApplying] = useState(false)
  const confirmReplace = (title: string) =>
    !(design.front.length || design.back.length) ||
    window.confirm(
      `지금 디자인이 「${title}」 시안으로 바뀝니다. 바꾼 뒤에도 실행 취소(⌘Z)로 되돌릴 수 있어요.`
    )
  const apply = async (item: PublishedTemplate) => {
    if (!confirmReplace(item.title)) return
    setApplying(true)
    await loadPublished(item)
    setApplying(false)
    setPreviewing(null)
  }
  return (
    <>
      {mode === "customer" ? (
        <>
          {publishedTemplates.length ? (
            <div className="grid grid-cols-2 gap-2 group-data-[wide]/panel:grid-cols-4">
              {publishedTemplates.map((item) => (
                <button
                  key={item.id}
                  title={item.title}
                  aria-label={`${item.title} 시안 미리보기`}
                  aria-pressed={previewing?.item.id === item.id}
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect()
                    setPreviewing(
                      previewing?.item.id === item.id
                        ? null
                        : { item, top: rect.top, left: rect.right + 8 }
                    )
                  }}
                  className={`flex h-40 items-center justify-center bg-[#f5f5f5] p-2 hover:outline hover:outline-2 hover:outline-[#5e9bd9] ${previewing?.item.id === item.id ? "outline outline-2 outline-[#5e9bd9]" : ""}`}
                >
                  <img
                    src={item.thumbnail}
                    alt=""
                    className="max-h-full max-w-full object-contain"
                  />
                </button>
              ))}
            </div>
          ) : (
            <p className="rounded bg-slate-100 p-4 text-sm text-slate-600">
              게시된 시안이 없습니다.
            </p>
          )}
          {previewing && (
            <div
              role="dialog"
              aria-label={`${previewing.item.title} 미리보기`}
              className="fixed z-40 w-[360px] bg-white p-3 shadow-[0_8px_24px_rgba(0,0,0,0.18)]"
              style={{
                top: Math.min(previewing.top, window.innerHeight - 320),
                left: previewing.left,
              }}
            >
              <img
                src={previewing.item.thumbnail}
                alt={previewing.item.title}
                className="mx-auto max-h-60 max-w-full object-contain"
              />
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="truncate text-sm text-slate-600">
                  {previewing.item.title}
                </span>
                <button
                  type="button"
                  disabled={applying}
                  onClick={() => void apply(previewing.item)}
                  className="shrink-0 bg-[#5bc0be] px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {applying ? "불러오는 중" : "적용"}
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <input
            value={templateSearch}
            onChange={(e) => setTemplateSearch(e.target.value)}
            placeholder="상품명 또는 인쇄 유형 검색"
            aria-label="템플릿 검색"
            className="mb-4 w-full border p-2 text-sm"
          />
          <div className="grid grid-cols-2 gap-2 group-data-[wide]/panel:grid-cols-4">
            {Object.entries(PRINT_PRODUCTS)
              .filter(
                ([id, item]) =>
                  (!productId || id === productId) &&
                  (item.title.includes(templateSearch) ||
                    PRINT_SPECS[item.kind].label.includes(templateSearch))
              )
              .map(([id, item]) => (
                <button
                  key={id}
                  title={item.title}
                  aria-label={`${item.title} 시작 시안 불러오기`}
                  onClick={() => confirmReplace(item.title) && applyStarter(id)}
                  className="group flex h-40 items-center justify-center bg-[#f5f5f5] p-2 hover:outline hover:outline-2 hover:outline-[#5e9bd9]"
                >
                  <svg
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    className="max-h-full max-w-full border bg-white"
                    style={{
                      aspectRatio: `${PRINT_SPECS[item.kind].sizes[0][0]} / ${PRINT_SPECS[item.kind].sizes[0][1]}`,
                    }}
                    aria-hidden="true"
                  >
                    <rect width="100" height="100" fill="white" />
                    <text
                      x="50"
                      y="30"
                      textAnchor="middle"
                      fontSize="5"
                      fontWeight="bold"
                      textLength="80"
                      lengthAdjust="spacingAndGlyphs"
                    >
                      {item.title.slice(0, 16)}
                    </text>
                    <text
                      x="50"
                      y="58"
                      textAnchor="middle"
                      fontSize="3"
                      textLength="76"
                      lengthAdjust="spacingAndGlyphs"
                    >
                      이벤트 내용과 연락처를 입력하세요
                    </text>
                  </svg>
                </button>
              ))}
          </div>
        </>
      )}
    </>
  )
}
