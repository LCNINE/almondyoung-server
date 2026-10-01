"use client"

import { cn } from "@/lib/utils"
import { Info, Palette, Search } from "lucide-react"
import { useMemo, useRef, useState } from "react"
import { PRINT_PRODUCTS, PRINT_SPECS, type PrintKind } from "../lib/catalog"
import {
  COLORS,
  INDUSTRIES,
  PURPOSES,
  filterTemplates,
  published,
  type PublishedTemplate,
} from "../lib/gallery-filter"

type Props = {
  countryCode: string
  productId: string
  variantId: string
  size: string
  initialKind?: PrintKind
  templates: PublishedTemplate[] | null
}

const GROUPS = [
  {
    id: "all",
    label: "전체품목",
    kinds: ["pet", "mini", "card", "window", "menu", "diploma", "nail"],
  },
  { id: "sign", label: "배너·현수막", kinds: ["pet", "mini", "window"] },
  { id: "paper", label: "카드·인쇄물", kinds: ["card", "nail"] },
  { id: "board", label: "메뉴판·수료증", kinds: ["menu", "diploma"] },
] as const

const PAGE_SIZE = 18

const COLUMNS: Record<PrintKind | "default", string> = {
  pet: "grid-cols-3 md:grid-cols-6",
  mini: "grid-cols-3 md:grid-cols-6",
  window: "grid-cols-1 md:grid-cols-2",
  card: "grid-cols-2 md:grid-cols-4",
  nail: "grid-cols-2 md:grid-cols-4",
  menu: "grid-cols-2 md:grid-cols-4",
  diploma: "grid-cols-2 md:grid-cols-4",
  default: "grid-cols-2 md:grid-cols-4",
}

const SHORT_NAMES: Record<PrintKind, string> = {
  pet: "배너",
  mini: "미니배너",
  window: "현수막",
  card: "카드",
  nail: "네일팁 종이",
  menu: "메뉴판",
  diploma: "수료증",
}

function groupFor(kind: PrintKind) {
  return (
    GROUPS.find(
      (group) =>
        group.id !== "all" && (group.kinds as readonly string[]).includes(kind)
    )?.id ?? "all"
  )
}

export function AlmondTemplateGallery({
  countryCode,
  productId,
  variantId,
  size,
  initialKind,
  templates,
}: Props) {
  const product = PRINT_PRODUCTS[productId]
  const startKind = product?.kind ?? initialKind
  const failed = templates === null
  const items = useMemo(() => (templates ?? []).filter(published), [templates])
  const [group, setGroup] = useState<string>(
    startKind ? groupFor(startKind) : "all"
  )
  const [kind, setKind] = useState<PrintKind | "">(startKind ?? "")
  const [selectedSize, setSelectedSize] = useState(size)
  const [colors, setColors] = useState<string[]>([])
  const [keywordInput, setKeywordInput] = useState("")
  const [keyword, setKeyword] = useState("")
  const [industry, setIndustry] = useState("")
  const [purpose, setPurpose] = useState("")
  const [page, setPage] = useState(1)
  const resultsRef = useRef<HTMLDivElement>(null)

  const availableKinds =
    GROUPS.find((entry) => entry.id === group)?.kinds ?? GROUPS[0].kinds
  const availableSizes = kind
    ? PRINT_SPECS[kind].sizes
    : Array.from(
        new Set(
          availableKinds.flatMap((entry) =>
            PRINT_SPECS[entry].sizes.map(([w, h]) => `${w}x${h}`)
          )
        )
      ).map((entry) => entry.split("x").map(Number))

  const filtered = useMemo(
    () =>
      filterTemplates(items, {
        productId,
        availableKinds,
        kind,
        size: selectedSize,
        keyword,
        colors,
        industry,
        purpose,
      }),
    [
      items,
      productId,
      availableKinds,
      kind,
      selectedSize,
      keyword,
      colors,
      industry,
      purpose,
    ]
  )

  const pageCount = Math.ceil(filtered.length / PAGE_SIZE)
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const pageStart = Math.floor((page - 1) / 10) * 10 + 1
  const pages = Array.from(
    { length: Math.min(10, pageCount - pageStart + 1) },
    (_, index) => pageStart + index
  )
  const movePage = (next: number) => {
    setPage(next)
    resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }
  const chooseGroup = (next: string) => {
    setGroup(next)
    setKind("")
    setSelectedSize("")
    setPage(1)
  }
  const chooseKind = (next: PrintKind | "") => {
    setKind(next)
    setSelectedSize("")
    setPage(1)
  }
  const toggleColor = (value: string) => {
    setColors((current) =>
      current.includes(value)
        ? current.filter((entry) => entry !== value)
        : [...current, value]
    )
    setPage(1)
  }

  const startKindForBlank = kind || availableKinds[0]
  const startSize =
    selectedSize ||
    PRINT_SPECS[startKindForBlank].sizes.map(([w, h]) => `${w}x${h}`)[0]
  const startParams = new URLSearchParams({
    product:
      productId ||
      Object.keys(PRINT_PRODUCTS).find(
        (id) => PRINT_PRODUCTS[id].kind === startKindForBlank
      ) ||
      "",
    size: startSize,
  })
  if (variantId) startParams.set("variant", variantId)
  const columns = kind ? COLUMNS[kind] : COLUMNS.default
  const chip = (active: boolean) =>
    cn(
      "mr-5 mb-[15px] text-[15px] md:text-[18px]",
      active
        ? "rounded-[15px] bg-[#cd0067] px-[15px] py-[3px] text-white"
        : "hover:text-[#cd0067]"
    )
  const textOption = (active: boolean) =>
    cn(
      "mr-5 mb-[15px] min-w-[100px] text-left text-[14px] md:min-w-[140px] md:text-[15px]",
      active ? "text-[#cd0067]" : "hover:text-[#cd0067]"
    )
  const row = "flex border-b border-[#d9d9d9]"
  const th =
    "flex w-[88px] shrink-0 items-center bg-[#313131] pl-3 text-[15px] font-semibold text-white md:w-[150px] md:pl-5 md:text-[20px]"

  return (
    <main className="mx-auto w-full max-w-[1500px] pt-6 pb-0 font-[Pretendard] tracking-[-0.1px] text-[#656565]">
      <h1 className="sr-only">아몬드템플릿</h1>
      <section
        aria-label="템플릿 검색 조건"
        className="border-t border-[#d9d9d9]"
      >
        <div className={row}>
          <strong className={th}>카테고리</strong>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center border-b border-[#d9d9d9] px-4 pt-[15px] md:px-[25px]">
              {GROUPS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => chooseGroup(entry.id)}
                  className={chip(group === entry.id)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center px-4 pt-[15px] md:px-[25px]">
              {!productId && (
                <button
                  type="button"
                  onClick={() => chooseKind("")}
                  className={chip(!kind)}
                >
                  전체
                </button>
              )}
              {availableKinds.map((entry) => (
                <button
                  key={entry}
                  type="button"
                  onClick={() => chooseKind(entry)}
                  className={chip(kind === entry)}
                >
                  {PRINT_SPECS[entry].label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className={row}>
          <strong className={cn(th, "py-3")}>사이즈</strong>
          <div className="flex flex-1 flex-wrap items-center px-4 pt-[15px] md:px-[25px]">
            {!size && (
              <button
                type="button"
                onClick={() => {
                  setSelectedSize("")
                  setPage(1)
                }}
                className={textOption(!selectedSize)}
              >
                전체
              </button>
            )}
            {availableSizes.map(([w, h]) => {
              const value = `${w}x${h}`
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setSelectedSize(value)
                    setPage(1)
                  }}
                  className={textOption(selectedSize === value)}
                >
                  {value}
                </button>
              )
            })}
          </div>
        </div>
        {(
          [
            ["업종", INDUSTRIES, industry, setIndustry],
            ["용도", PURPOSES, purpose, setPurpose],
          ] as const
        ).map(([label, options, value, setValue]) => (
          <div key={label} className={row}>
            <strong className={cn(th, "py-3")}>{label}</strong>
            <div className="flex flex-1 flex-wrap items-center px-4 pt-[15px] md:px-[25px]">
              {["", ...options].map((option) => (
                <button
                  key={option || "all"}
                  type="button"
                  onClick={() => {
                    setValue(option)
                    setPage(1)
                  }}
                  className={textOption(value === option)}
                >
                  {option || "전체"}
                </button>
              ))}
            </div>
          </div>
        ))}
        <div className={row}>
          <strong className={cn(th, "py-3")}>검색</strong>
          <div className="flex flex-1 flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3 md:px-[25px] md:py-[7px]">
            <div className="flex flex-wrap items-center gap-[6px]">
              <Palette className="h-5 w-5 text-[#333]" />
              <b className="mr-3 text-[15px] text-[#333]">컬러 검색</b>
              {COLORS.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-label={`${label} 색상 ${colors.includes(value) ? "해제" : "선택"}`}
                  aria-pressed={colors.includes(value)}
                  title={label}
                  onClick={() => toggleColor(value)}
                  className={cn(
                    "h-5 w-5 rounded-full border border-[#d9d9d9]",
                    colors.includes(value) &&
                      "ring-2 ring-[#cd0067] ring-offset-1"
                  )}
                  style={{ backgroundColor: value }}
                />
              ))}
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault()
                setKeyword(keywordInput.trim())
                setPage(1)
              }}
              className="flex w-full items-center gap-0 md:w-auto"
            >
              <span className="mr-8 hidden text-[15px] font-bold text-black md:inline">
                검색어 입력
              </span>
              <input
                aria-label="템플릿 검색어"
                placeholder="검색어를 입력하세요~"
                value={keywordInput}
                onChange={(event) => setKeywordInput(event.target.value)}
                className="h-10 min-w-0 flex-1 border border-[#d9d9d9] bg-[#d9d9d9] px-[10px] text-center text-[14px] text-[#0f0f0f] placeholder:text-[#999] md:w-[350px] md:flex-none"
              />
              <button
                type="submit"
                className="ml-2 flex h-10 items-center gap-2 bg-[#008000] px-4 text-[16px] font-semibold text-white md:px-6"
              >
                <Search className="h-5 w-5" strokeWidth={2.5} />
                검색하기
              </button>
            </form>
          </div>
        </div>
      </section>
      <div ref={resultsRef} className="scroll-mt-8 pt-[50px]">
        {failed ? (
          <div className="py-24 text-center">
            시안 목록을 불러오지 못했습니다. 페이지를 새로고침해 주세요.
          </div>
        ) : (
          <ul className={cn("grid items-start", columns)}>
            {page === 1 && (
              <li className="px-[7px] pb-5 text-center">
                <a
                  href={`/${countryCode}/almond-template/edit?${startParams}`}
                  className="block"
                >
                  <BlankDesignCard
                    name={SHORT_NAMES[startKindForBlank]}
                    size={startSize}
                  />
                  <span className="mt-[10px] block truncate text-[14px]">
                    직접하는 나만의 디자인
                  </span>
                </a>
              </li>
            )}
            {visible.map((item) => {
              const params = new URLSearchParams({
                product: item.productId,
                size: item.size,
                template: item.id,
              })
              if (variantId) params.set("variant", variantId)
              return (
                <li key={item.id} className="min-w-0 px-[7px] pb-5 text-center">
                  <a
                    href={`/${countryCode}/almond-template/edit?${params}`}
                    className="group block"
                  >
                    <img
                      src={item.thumbnail}
                      alt=""
                      loading="lazy"
                      style={{ aspectRatio: item.size.replace("x", " / ") }}
                      className="w-full bg-white object-contain shadow-[2px_3px_6px_rgba(0,0,0,0.18)] transition-shadow group-hover:shadow-[2px_4px_12px_rgba(0,0,0,0.3)]"
                    />
                    <span
                      className="mt-[10px] block truncate text-[14px] group-hover:text-[#cd0067]"
                      title={item.title}
                    >
                      {item.title}
                    </span>
                  </a>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      {pageCount > 1 && (
        <nav
          aria-label="템플릿 페이지"
          className="mt-10 flex flex-wrap items-center justify-center text-[13px] text-[#313040]"
        >
          {(
            [
              ["첫 페이지", "«", 1, page === 1],
              ["이전 페이지", "‹", page - 1, page === 1],
            ] as const
          ).map(([label, glyph, target, disabled]) => (
            <button
              key={label}
              type="button"
              aria-label={label}
              disabled={disabled}
              onClick={() => movePage(target)}
              className="-ml-px h-[34px] w-[34px] border border-[#d9d9d9] disabled:opacity-40"
            >
              {glyph}
            </button>
          ))}
          {pages.map((number) => (
            <button
              key={number}
              type="button"
              aria-label={`${number} 페이지`}
              aria-current={number === page ? "page" : undefined}
              onClick={() => movePage(number)}
              className={cn(
                "-ml-px h-[34px] w-[34px] border",
                number === page
                  ? "border-[#313040] bg-[#313040] font-bold text-white"
                  : "border-[#d9d9d9] font-thin"
              )}
            >
              {number}
            </button>
          ))}
          {(
            [
              ["다음 페이지", "›", page + 1, page === pageCount],
              ["마지막 페이지", "»", pageCount, page === pageCount],
            ] as const
          ).map(([label, glyph, target, disabled]) => (
            <button
              key={label}
              type="button"
              aria-label={label}
              disabled={disabled}
              onClick={() => movePage(target)}
              className="-ml-px h-[34px] w-[34px] border border-[#d9d9d9] disabled:opacity-40"
            >
              {glyph}
            </button>
          ))}
        </nav>
      )}
      <section className="mt-20 bg-[#f5f5f5] px-6 py-8 text-[13px] leading-7 text-[#656565] md:px-[25px]">
        <h2 className="mb-2 flex items-center gap-1 text-[15px] font-bold text-[#333]">
          <Info className="h-4 w-4" strokeWidth={2.5} />
          작업 시 유의사항
        </h2>
        <p>
          · 글꼴과 이미지는 사용 권한을 확인하고, 인쇄용 파일 제작 전 글꼴을
          아웃라인 처리해 주세요.
        </p>
        <p>· 저장한 시안은 같은 상품과 크기에서 불러올 수 있습니다.</p>
        <p>· 이미지 해상도와 안전영역을 확인한 뒤 주문해 주세요.</p>
      </section>
    </main>
  )
}

function objectParticle(word: string) {
  const code = word.charCodeAt(word.length - 1) - 0xac00
  return code >= 0 && code % 28 ? "을" : "를"
}

function BlankDesignCard({ name, size }: { name: string; size: string }) {
  const [w, h] = size.split("x").map(Number)
  const wide = w / h > 1.6
  return (
    <div
      style={{ aspectRatio: `${w} / ${h}` }}
      className={cn(
        "flex w-full items-center justify-center gap-4 bg-white p-4 text-[#111] shadow-[2px_3px_6px_rgba(0,0,0,0.18)]",
        wide ? "flex-row" : "flex-col"
      )}
    >
      <svg
        viewBox="0 0 120 80"
        className={cn("shrink-0", wide ? "h-[45%]" : "w-[65%] max-w-[180px]")}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        aria-hidden
      >
        <rect x="6" y="6" width="104" height="66" />
        {[
          [6, 6],
          [58, 6],
          [110, 6],
          [6, 39],
          [110, 39],
          [6, 72],
          [58, 72],
          [110, 72],
        ].map(([x, y]) => (
          <rect
            key={`${x}-${y}`}
            x={x - 3.5}
            y={y - 3.5}
            width="7"
            height="7"
            fill="#fff"
          />
        ))}
        <path d="M18 54l20-22 14 14 12-14 22 22" />
        <path d="M88 44l-8 16 8 10 8-10z" fill="#fff" />
        <circle cx="88" cy="58" r="2.2" />
        <path d="M88 44v12" />
      </svg>
      <p
        className={cn(
          "leading-snug break-keep",
          wide
            ? "text-left text-[clamp(14px,2.2vw,30px)]"
            : "text-center text-[clamp(13px,1.4vw,20px)]"
        )}
      >
        나만의 <b>{name}</b>
        {objectParticle(name)}
        {wide ? " " : <br />}
        <b>디자인</b>해보세요!
      </p>
    </div>
  )
}
