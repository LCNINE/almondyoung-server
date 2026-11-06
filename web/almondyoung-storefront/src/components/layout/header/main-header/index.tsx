import { AutoHideHeader } from "@/components/layout/header/auto-hide-header"
import { SearchCombobox } from "@/components/search/search-combobox"
import { SearchSheet } from "@/components/search/search-sheet"
import { listRootCategoriesCached } from "@/lib/data/category"
import { CategoryNav } from "./category-nav"
import { Logo } from "./logo"
import { ServiceBar } from "./service-bar"
import { AccountMenu } from "./user-actions"
import { TopNoticeBar } from "../top-notice-bar"

type Categories = Awaited<ReturnType<typeof listRootCategoriesCached>>

// 제출 버튼만 title 을 가져서(지우기 버튼은 없음) 그것으로 골라 ink 원형 버튼으로 바꾼다
const SEARCH_CLASS_NAME =
  "order-3 basis-full xl:order-none xl:max-w-[560px] xl:flex-1 xl:basis-auto [&_div.absolute]:right-1.5 [&_button[title]]:bg-ink [&_button[title]]:hover:bg-ink/90 [&_button[title]]:size-9 xl:[&_button[title]]:size-[38px] [&_button[title]_svg]:text-white [&_button[title]_svg]:h-[18px] [&_button[title]_svg]:w-[18px]"

const SEARCH_INPUT_CLASS_NAME =
  "border-ink h-11 rounded-full border-2 border-solid bg-white py-0 pr-14 pl-[22px] text-[15px] placeholder:text-[15px] placeholder:text-gray-400 focus-visible:bg-white focus-visible:ring-0 xl:h-12"

export async function MainHeader() {
  let categories: Categories = []

  try {
    categories = await listRootCategoriesCached()
  } catch (error) {
    console.error("[MainHeader] Failed to load categories:", error)
  }

  return (
    <>
      <div aria-hidden className="grid h-[3px] grid-cols-[5fr_3fr_2fr]">
        <i className="bg-mint" />
        <i className="bg-pink" />
        <i className="bg-purple" />
      </div>

      <TopNoticeBar />

      <ServiceBar />

      <AutoHideHeader className="sticky top-0 z-40 overflow-visible bg-white">
        <div className="container mx-auto flex max-w-[1280px] flex-wrap items-center gap-3 px-4 py-3 xl:h-[88px] xl:flex-nowrap xl:gap-10 xl:px-[32px] xl:py-0">
          <Logo />

          <SearchCombobox
            className={SEARCH_CLASS_NAME}
            inputClassName={SEARCH_INPUT_CLASS_NAME}
          />

          <div className="ml-auto">
            <AccountMenu />
          </div>
        </div>

        <CategoryNav categories={categories} />

        <SearchSheet />
      </AutoHideHeader>
    </>
  )
}
