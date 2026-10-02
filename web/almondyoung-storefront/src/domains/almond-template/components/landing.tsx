"use client"

import LocalizedClientLink from "@/components/shared/localized-client-link"
import { cn } from "@/lib/utils"
import { useState } from "react"
import { PRINT_SPECS, type PrintKind } from "../lib/catalog"

const TABS: { id: string; label: string; kinds: PrintKind[] }[] = [
  {
    id: "all",
    label: "전체보기",
    kinds: ["pet", "mini", "window", "card", "nail", "menu", "diploma"],
  },
  { id: "sign", label: "배너·현수막", kinds: ["pet", "mini", "window"] },
  { id: "paper", label: "카드·인쇄물", kinds: ["card", "nail"] },
  { id: "board", label: "메뉴판·수료증", kinds: ["menu", "diploma"] },
]

const DESCRIPTIONS: Record<PrintKind, string> = {
  pet: "가게 앞에 세워 손님을 부르는 입간판",
  mini: "카운터·테이블 위 작은 홍보 배너",
  window: "유리창에 붙여 지나가는 손님에게",
  card: "시술 후 관리법을 한 장으로 안내",
  nail: "네일팁을 붙여 보여주는 디스플레이",
  menu: "시술 메뉴와 가격을 깔끔하게",
  diploma: "교육 수료를 증명하는 디플로마",
}

const STEPS = [
  ["01", "마음에 드는 시안 고르기"],
  ["02", "문구·사진을 우리 샵에 맞게 편집"],
  ["03", "주문하면 인쇄해서 배송"],
]

type Props = {
  thumbnails: Partial<Record<PrintKind, string>>
}

export function AlmondTemplateLanding({ thumbnails }: Props) {
  const [tab, setTab] = useState(TABS[0].id)
  const kinds = TABS.find((entry) => entry.id === tab)?.kinds ?? TABS[0].kinds

  return (
    <div className="bg-white font-[Pretendard] tracking-[-0.1px] text-[#656565]">
      <section className="relative overflow-hidden bg-[linear-gradient(110deg,#fde7d3_0%,#f6c9a8_45%,#e9a98a_100%)]">
        <div className="mx-auto flex max-w-[1200px] flex-col-reverse gap-8 px-4 py-10 md:min-h-[410px] md:flex-row md:items-end md:justify-between md:px-0 md:py-0">
          <div className="w-full bg-black/30 px-6 pt-6 pb-2 md:w-[430px] md:px-10 md:pt-[30px]">
            <div className="flex items-center justify-between border-b border-white pb-2">
              <h2 className="text-[20px] font-semibold text-white md:text-[22px]">
                아몬드템플릿 이용 안내
              </h2>
              <LocalizedClientLink
                href="/almond-template"
                className="rounded-[20px] bg-black/50 px-3 py-[5px] text-[14px] font-bold text-white md:text-[15px]"
              >
                전체 시안 +
              </LocalizedClientLink>
            </div>
            <ul>
              {STEPS.map(([no, text], index) => (
                <li
                  key={no}
                  className={cn(
                    "flex h-10 items-center gap-3 text-[14px] text-white",
                    index < STEPS.length - 1 &&
                      "border-b border-dashed border-white"
                  )}
                >
                  <span className="font-semibold">{no}</span>
                  {text}
                </li>
              ))}
            </ul>
          </div>

          <div className="text-center md:self-center md:text-right">
            <span className="inline-block rounded-full bg-white px-6 py-2 text-[16px] text-[#333] md:text-[20px]">
              아몬드템플릿 새소식
            </span>
            <p className="mt-5 text-[32px] leading-[1.2] font-extrabold text-white [text-shadow:0_2px_8px_rgba(0,0,0,0.15)] md:text-[48px]">
              디자이너 없이도
              <br />
              우리 샵 홍보물 완성
            </p>
          </div>
        </div>
      </section>

      <nav aria-label="템플릿 분류" className="bg-[#5e9ce3]">
        <ul className="scrollbar-hide mx-auto flex max-w-[1200px] overflow-x-auto">
          {TABS.map((entry, index) => (
            <li
              key={entry.id}
              className={cn(
                "flex h-[72px] min-w-[120px] flex-1 items-center justify-center md:h-[110px]",
                index > 0 && "border-l border-white/30"
              )}
            >
              <button
                type="button"
                onClick={() => setTab(entry.id)}
                className={cn(
                  "border-b-[3px] pb-1 text-[18px] font-extrabold whitespace-nowrap transition-colors md:text-[32px]",
                  tab === entry.id
                    ? "border-[#16336b] text-[#16336b]"
                    : "border-transparent text-white hover:text-[#16336b]"
                )}
              >
                {entry.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <section className="mx-auto max-w-[1200px] px-4 pt-[30px] pb-[100px] md:px-0">
        <ul className="grid grid-cols-2 gap-x-4 md:grid-cols-4 md:gap-x-10">
          {kinds.map((kind) => (
            <li key={kind} className="mt-[30px] mb-5 text-center">
              <LocalizedClientLink
                href={`/almond-template?kind=${kind}`}
                className="group block"
              >
                <div className="flex aspect-square w-full items-center justify-center overflow-hidden bg-[#f3f4f5] p-5">
                  {thumbnails[kind] ? (
                    <img
                      src={thumbnails[kind]}
                      alt=""
                      loading="lazy"
                      className="max-h-full max-w-full object-contain drop-shadow-md transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <span className="text-[14px] text-[#aaa]">
                      {PRINT_SPECS[kind].label}
                    </span>
                  )}
                </div>
                <p className="mt-5 text-[16px] font-medium md:text-[18px]">
                  {PRINT_SPECS[kind].label}
                </p>
                <p className="text-[13px] font-light md:text-[14px]">
                  {DESCRIPTIONS[kind]}
                </p>
              </LocalizedClientLink>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
