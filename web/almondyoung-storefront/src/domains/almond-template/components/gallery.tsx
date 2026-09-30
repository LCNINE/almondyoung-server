"use client"

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
  templates,
}: Props) {
  const product = PRINT_PRODUCTS[productId]
  const failed = templates === null
  const items = useMemo(() => (templates ?? []).filter(published), [templates])
  const [group, setGroup] = useState<string>(
    product ? groupFor(product.kind) : "all"
  )
  const [kind, setKind] = useState<PrintKind | "">(product?.kind ?? "")
  const [selectedSize, setSelectedSize] = useState(size)
  const [colors, setColors] = useState<string[]>([])
  const [keywordInput, setKeywordInput] = useState("")
  const [keyword, setKeyword] = useState("")
  const [advanced, setAdvanced] = useState(false)
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

  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-10 text-[#333] lg:px-8">
      <h1 className="mb-2 text-3xl font-bold">아몬드템플릿</h1>
      <p className="mb-8 text-sm text-[#777]">
        시안을 선택해 문구와 이미지를 편집하세요.
      </p>
      <section
        aria-label="템플릿 검색 조건"
        className="border-t-2 border-[#333] text-[14px]"
      >
        <div className="grid grid-cols-[94px_1fr] border-b border-[#ddd]">
          <strong className="bg-[#f6f6f6] px-3 py-5">카테고리</strong>
          <div>
            <div className="flex flex-wrap gap-x-7 gap-y-2 border-b border-[#eee] px-5 py-4">
              {GROUPS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => chooseGroup(entry.id)}
                  className={
                    group === entry.id
                      ? "font-bold text-[#e13b40] underline underline-offset-4"
                      : "hover:text-[#e13b40]"
                  }
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-x-7 gap-y-2 border-b border-[#eee] px-5 py-4">
              {(group === "all"
                ? GROUPS.slice(1)
                : GROUPS.filter((entry) => entry.id === group)
              ).map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => chooseGroup(entry.id)}
                  className={
                    group === entry.id
                      ? "font-bold text-[#e13b40]"
                      : "hover:text-[#e13b40]"
                  }
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-x-7 gap-y-2 px-5 py-4">
              {!productId && (
                <button
                  type="button"
                  onClick={() => chooseKind("")}
                  className={
                    !kind ? "font-bold text-[#e13b40]" : "hover:text-[#e13b40]"
                  }
                >
                  전체
                </button>
              )}
              {availableKinds.map((entry) => (
                <button
                  key={entry}
                  type="button"
                  onClick={() => chooseKind(entry)}
                  className={
                    kind === entry
                      ? "font-bold text-[#e13b40]"
                      : "hover:text-[#e13b40]"
                  }
                >
                  {PRINT_SPECS[entry].label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-[94px_1fr] border-b border-[#ddd]">
          <strong className="bg-[#f6f6f6] px-3 py-5">사이즈</strong>
          <div className="flex flex-wrap gap-3 px-5 py-4">
            {!size && (
              <button
                type="button"
                onClick={() => {
                  setSelectedSize("")
                  setPage(1)
                }}
                className={`rounded border px-3 py-1.5 ${!selectedSize ? "border-[#e13b40] font-bold text-[#e13b40]" : "border-[#ddd]"}`}
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
                  className={`rounded border px-3 py-1.5 ${selectedSize === value ? "border-[#e13b40] font-bold text-[#e13b40]" : "border-[#ddd] hover:border-[#e13b40]"}`}
                >
                  {value}
                </button>
              )
            })}
          </div>
        </div>
        <div className="grid grid-cols-[94px_1fr] border-b border-[#ddd]">
          <strong className="bg-[#f6f6f6] px-3 py-5">검색</strong>
          <div className="px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-3 text-sm">컬러 검색</span>
              {COLORS.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-label={`${label} 색상 ${colors.includes(value) ? "해제" : "선택"}`}
                  aria-pressed={colors.includes(value)}
                  title={label}
                  onClick={() => toggleColor(value)}
                  className={`h-7 w-7 rounded-full border ${colors.includes(value) ? "ring-2 ring-[#e13b40] ring-offset-2" : ""}`}
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
              className="mt-4 flex max-w-[530px] gap-2"
            >
              <input
                aria-label="템플릿 검색어"
                placeholder="검색어를 입력하세요"
                value={keywordInput}
                onChange={(event) => setKeywordInput(event.target.value)}
                className="min-w-0 flex-1 border border-[#ccc] px-3 py-2"
              />
              <button
                type="submit"
                className="min-w-20 bg-[#333] px-4 text-white"
              >
                검색
              </button>
            </form>
            <button
              type="button"
              onClick={() => setAdvanced(!advanced)}
              aria-expanded={advanced}
              className="mt-3 text-sm text-[#666] underline"
            >
              상세검색 {advanced ? "접기 −" : "열기 +"}
            </button>
          </div>
        </div>
        {advanced && (
          <>
            <div className="grid grid-cols-[94px_1fr] border-b border-[#ddd]">
              <strong className="bg-[#f6f6f6] px-3 py-5">업종</strong>
              <div className="flex flex-wrap gap-2 px-5 py-4">
                {["전체", ...INDUSTRIES].map((label) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => {
                      setIndustry(label === "전체" ? "" : label)
                      setPage(1)
                    }}
                    className={`rounded border px-3 py-1 ${industry === (label === "전체" ? "" : label) ? "border-[#e13b40] text-[#e13b40]" : "border-[#ddd]"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-[94px_1fr] border-b border-[#ddd]">
              <strong className="bg-[#f6f6f6] px-3 py-5">용도</strong>
              <div className="flex flex-wrap gap-2 px-5 py-4">
                {["전체", ...PURPOSES].map((label) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => {
                      setPurpose(label === "전체" ? "" : label)
                      setPage(1)
                    }}
                    className={`rounded border px-3 py-1 ${purpose === (label === "전체" ? "" : label) ? "border-[#e13b40] text-[#e13b40]" : "border-[#ddd]"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </section>
      <div ref={resultsRef} className="scroll-mt-8 pt-10">
        <p className="mb-5 text-sm text-[#777]">
          {`검색 결과 ${filtered.length}개`}
        </p>
        {failed ? (
          <div className="py-24 text-center">
            시안 목록을 불러오지 못했습니다. 페이지를 새로고침해 주세요.
          </div>
        ) : !filtered.length ? (
          <div className="border-y border-[#ddd] py-24 text-center text-[#777]">
            조건에 맞는 공개 시안이 없습니다.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-5 gap-y-12 border-t border-[#ddd] pt-9 lg:grid-cols-4 2xl:grid-cols-5">
            {visible.map((item) => {
              const params = new URLSearchParams({
                product: item.productId,
                size: item.size,
                template: item.id,
              })
              if (variantId) params.set("variant", variantId)
              return (
                <a
                  key={item.id}
                  href={`/${countryCode}/almond-template/edit?${params}`}
                  className="group min-w-0 text-center"
                >
                  <div
                    className="flex w-full items-center justify-center bg-white p-2 transition-shadow group-hover:shadow-lg"
                    style={{ aspectRatio: item.size.replace("x", " / ") }}
                  >
                    <img
                      src={item.thumbnail}
                      alt=""
                      loading="lazy"
                      className="max-h-full max-w-full object-contain drop-shadow-md"
                    />
                  </div>
                  <p
                    className="mt-3 truncate text-sm group-hover:text-[#e13b40]"
                    title={item.title}
                  >
                    {item.title}
                  </p>
                </a>
              )
            })}
          </div>
        )}
      </div>
      {pageCount > 1 && (
        <nav
          aria-label="템플릿 페이지"
          className="mt-12 flex flex-wrap items-center justify-center gap-1 text-sm"
        >
          <button
            type="button"
            aria-label="첫 페이지"
            disabled={page === 1}
            onClick={() => movePage(1)}
            className="h-9 w-9 border disabled:opacity-40"
          >
            《
          </button>
          <button
            type="button"
            aria-label="이전 페이지"
            disabled={page === 1}
            onClick={() => movePage(page - 1)}
            className="h-9 w-9 border disabled:opacity-40"
          >
            〈
          </button>
          {pages.map((number) => (
            <button
              key={number}
              type="button"
              aria-label={`${number} 페이지`}
              aria-current={number === page ? "page" : undefined}
              onClick={() => movePage(number)}
              className={`h-9 w-9 border ${number === page ? "border-[#333] bg-[#333] text-white" : "border-[#ddd]"}`}
            >
              {number}
            </button>
          ))}
          <button
            type="button"
            aria-label="다음 페이지"
            disabled={page === pageCount}
            onClick={() => movePage(page + 1)}
            className="h-9 w-9 border disabled:opacity-40"
          >
            〉
          </button>
          <button
            type="button"
            aria-label="마지막 페이지"
            disabled={page === pageCount}
            onClick={() => movePage(pageCount)}
            className="h-9 w-9 border disabled:opacity-40"
          >
            》
          </button>
        </nav>
      )}
      <section className="mt-20 bg-[#f5f5f5] p-6 text-sm leading-7 text-[#666]">
        <h2 className="mb-2 font-bold text-[#333]">ⓘ 작업 시 유의사항</h2>
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
