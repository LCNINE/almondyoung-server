import { PRINT_PRODUCTS, PRINT_SPECS } from "../../../lib/catalog"
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
  const { productId, mode, publishedTemplates, loadPublished, applyStarter } =
    editor
  return (
    <>
      {mode === "customer" ? (
        <>
          {publishedTemplates.length ? (
            <div className="grid grid-cols-2 gap-2">
              {publishedTemplates.map((item) => (
                <button
                  key={item.id}
                  title={item.title}
                  aria-label={`${item.title} 시안 불러오기`}
                  onClick={() => void loadPublished(item)}
                  className="flex h-40 items-center justify-center bg-[#f5f5f5] p-2 hover:outline hover:outline-2 hover:outline-[#5e9bd9]"
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
          <div className="grid grid-cols-2 gap-2">
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
                  onClick={() => applyStarter(id)}
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
