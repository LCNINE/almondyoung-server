import { useState } from "react"
import { createPortal } from "react-dom"
import { Search, X } from "lucide-react"
import { PRINT_PRODUCTS, PRINT_SPECS } from "../../../lib/catalog"
import type { PublishedTemplate } from "../../../lib/gallery-filter"
import type { AlmondEditor } from "../../../hooks/use-almond-editor"

type Card = {
  id: string
  title: string
  thumbnail?: string
  ratio: number
  tags: string[]
  apply: () => void | Promise<void>
}

// 망고보드처럼 열마다 목록을 따로 두고 번갈아 담는다(높이가 제각각인 썸네일 masonry)
function columnsOf(cards: Card[], count: number) {
  const columns: Card[][] = Array.from({ length: count }, () => [])
  const heights = Array(count).fill(0)
  for (const card of cards) {
    const shortest = heights.indexOf(Math.min(...heights))
    columns[shortest].push(card)
    heights[shortest] += 1 / card.ratio
  }
  return columns
}

function TemplateCard({ card, onPick }: { card: Card; onPick: () => void }) {
  const [hover, setHover] = useState(false)
  const [info, setInfo] = useState<DOMRect | null>(null)
  return (
    <li
      className="relative"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false)
        setInfo(null)
      }}
    >
      <button
        type="button"
        aria-label={`${card.title} 템플릿 적용`}
        onClick={onPick}
        className="relative block w-full cursor-pointer overflow-hidden rounded-[6px] bg-[rgba(226,230,234,0.54)] outline outline-1 outline-offset-0 outline-[#F1F3F6] transition-[outline] duration-200 hover:outline-offset-[3px] hover:outline-[#6F717C]"
        style={{ aspectRatio: card.ratio, minHeight: 36 }}
      >
        {card.thumbnail ? (
          <img
            src={card.thumbnail}
            alt=""
            className="size-full object-contain"
          />
        ) : (
          <span className="flex size-full items-center justify-center bg-white px-2 text-center text-[12px] text-[#3F4250]">
            {card.title}
          </span>
        )}
      </button>
      {hover && (
        <button
          type="button"
          aria-label={`${card.title} 정보`}
          onMouseEnter={(event) =>
            setInfo(event.currentTarget.parentElement!.getBoundingClientRect())
          }
          onMouseLeave={() => setInfo(null)}
          className="absolute top-[3px] right-[3px] flex size-6 items-center justify-center rounded-[5px] bg-[rgba(255,255,255,0.9)] text-[#3F4250] transition-[background-color] duration-200 hover:bg-[#FEE869]"
        >
          <Search className="size-3.5" />
        </button>
      )}
      {info &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[10003] w-[250px] -translate-x-[2px] pl-3"
            style={{ left: info.right, top: info.top }}
          >
            <span className="absolute top-3 left-[2px] border-[5px] border-transparent border-r-[rgba(42,41,47,0.95)]" />
            <div className="rounded-[6px] bg-[rgba(42,41,47,0.95)] px-3 pt-2 pb-5">
              <p className="text-[13px] leading-[18px] font-medium text-[#9a9ca3]">
                태그
              </p>
              <p className="mt-[3px] mb-2 text-[13px] leading-[22px] font-medium text-[#F3F5F8]">
                {card.tags.length ? card.tags.join(", ") : card.title}
              </p>
            </div>
          </div>,
          document.body
        )}
    </li>
  )
}

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
  const [confirming, setConfirming] = useState<Card | null>(null)
  const query = templateSearch.trim()
  const cards: Card[] =
    mode === "customer"
      ? publishedTemplates
          .filter((item) => !query || item.title.includes(query))
          .map((item: PublishedTemplate) => {
            const [w, h] = item.size.split("x").map(Number)
            return {
              id: item.id,
              title: item.title,
              thumbnail: item.thumbnail,
              ratio: w && h ? w / h : 1,
              tags: [item.industry, item.purpose, item.size].filter(
                (tag): tag is string => !!tag
              ),
              apply: () => loadPublished(item),
            }
          })
      : Object.entries(PRINT_PRODUCTS)
          .filter(
            ([id, item]) =>
              (!productId || id === productId) &&
              (!query ||
                item.title.includes(query) ||
                PRINT_SPECS[item.kind].label.includes(query))
          )
          .map(([id, item]) => {
            const [w, h] = PRINT_SPECS[item.kind].sizes[0]
            return {
              id,
              title: item.title,
              ratio: w / h,
              tags: [PRINT_SPECS[item.kind].label],
              apply: () => applyStarter(id),
            }
          })
  // 빈 디자인이면 묻지 않고 바로 바꾼다
  const pick = (card: Card) =>
    design.front.length || design.back.length
      ? setConfirming(card)
      : void card.apply()
  return (
    <div className="-m-5">
      <label className="mt-[15px] mr-[23px] ml-[13px] flex h-[42px] items-center rounded-[7px] border border-[#D0D4D7] bg-white p-[5px] transition-[border] duration-[120ms] ease-in-out">
        <input
          value={templateSearch}
          onChange={(event) => setTemplateSearch(event.target.value)}
          placeholder="템플릿 제목으로 검색해 보세요."
          aria-label="템플릿 검색"
          className="h-[30px] min-w-0 flex-1 pl-1 text-[13px] text-[#212121] outline-none placeholder:text-[#AAACB0]"
        />
        <Search className="mr-1 size-4 text-[#70777F]" />
      </label>
      <div className="relative mt-[17px] mr-[22px] ml-[13px] flex border-b border-[#E6E7EA]">
        <span className="relative px-2 py-[10px] text-[14px] leading-[16.71px] font-semibold tracking-[-0.14px] text-[#20232A]">
          {mode === "customer" ? "디자인" : "시작 시안"}
          <span className="absolute right-0 bottom-[-1px] left-0 h-[3px] bg-[#FEDE29] transition-all duration-300 ease-[ease]" />
        </span>
      </div>
      {cards.length ? (
        <div className="flex gap-[15px] pt-5 pr-1 pb-5 pl-[13px]">
          {[2, 3].map((count) => (
            <div
              key={count}
              className={`flex-1 gap-[15px] ${count === 2 ? "flex group-data-[wide]/panel:hidden" : "hidden group-data-[wide]/panel:flex"}`}
            >
              {columnsOf(cards, count).map((column, index) => (
                <ul
                  key={index}
                  className="flex flex-1 flex-col gap-[15px] py-1"
                >
                  {column.map((card) => (
                    <TemplateCard
                      key={card.id}
                      card={card}
                      onPick={() => pick(card)}
                    />
                  ))}
                </ul>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <p className="px-[13px] pt-5 text-[13px] text-[#70777F]">
          {query
            ? `‘${query}’에 맞는 템플릿이 없습니다.`
            : "게시된 시안이 없습니다."}
        </p>
      )}
      {confirming && (
        <div className="fixed inset-0 z-[10002] flex items-center justify-center bg-[rgba(28,29,31,0.6)]">
          <div
            role="alertdialog"
            aria-label="현재 슬라이드의 내용이 선택한 템플릿으로 교체 됩니다."
            className="relative w-[450px] rounded-[14px] border border-[#E0E1E5] bg-white px-10 shadow-[3px_3px_10px_rgba(44,45,47,0.25)]"
          >
            <button
              type="button"
              aria-label="닫기"
              onClick={() => setConfirming(null)}
              className="absolute top-[11px] right-[11px] flex size-5 items-center justify-center text-[#70777F]"
            >
              <X className="size-3" />
            </button>
            <div className="h-10" />
            <div className="mb-[30px] flex flex-col gap-[15px]">
              <strong className="text-[16px] leading-[19.09px] font-semibold tracking-[-0.16px] text-[#20232A]">
                현재 디자인이 선택한 템플릿으로 교체 됩니다.
              </strong>
              <p className="text-[15px] leading-[23px] tracking-[-0.15px] text-[#70777F]">
                교체를 원치 않으시면 &apos;취소&apos;를 클릭하세요.
                <br />
                교체한 뒤에도 실행 취소(⌘Z)로 되돌릴 수 있습니다.
              </p>
            </div>
            <div className="mb-[30px] flex justify-end gap-[10px]">
              <button
                type="button"
                onClick={() => setConfirming(null)}
                className="h-[38px] w-[85px] rounded-[6px] bg-[#E2E7ED] text-[13px] font-medium text-[#3F4250]"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => {
                  const card = confirming
                  setConfirming(null)
                  void card.apply()
                }}
                className="h-[38px] w-[85px] rounded-[6px] bg-[#FEDE29] text-[13px] font-medium text-[#20232A]"
              >
                교체하기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
