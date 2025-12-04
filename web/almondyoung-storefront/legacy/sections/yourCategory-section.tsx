import Link from "next/link"

import { getAllCategoriesCached } from "@lib/services/pim/category/getCategory"
import Image from "next/image"
import { getCategoryTree } from "@lib/api/pim"
import { getShowOnMainCategory } from "@lib/utils/category-display-settings"
export const CategorySelectSection = async (props: { countryCode: string }) => {
  const categories = await getCategoryTree()

  // showOnMainCategory가 true인 카테고리만 필터링하고 sortOrder 순으로 정렬
  const filteredCategories = categories.categories
    .filter((category) => getShowOnMainCategory(category))
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
    .slice(0, 7)

  return (
    <div>
      {/* 카테고리 선택 섹션 - PIM 카테고리 데이터 사용 */}
      <div>
        <section className="bg-muted border-muted w-full border-t py-12 lg:py-20">
          <div className="px-4 md:mx-auto md:max-w-[1360px] md:px-[40px]">
            <div className="mb-8 text-center lg:mb-12">
              <h2 className="mb-3 text-2xl font-bold text-gray-900 md:text-3xl">
                딱! 맞는 재료만 보고 싶다면?
              </h2>
              <p className="text-sm text-gray-600 lg:text-lg">
                원하는 카테고리를 선택해보세요
              </p>
            </div>

            <div className="flex flex-wrap justify-center gap-2 md:gap-4">
              {/* 매핑된 카테고리 표시 */}
              {filteredCategories.map((category) => (
                <Link
                  key={category.id}
                  href={`/${props.countryCode}/category/${category.slug}`}
                  className="hover:border-yellow-30 flex flex-wrap items-center justify-center gap-2 rounded-sm border border-white bg-white px-2 py-2 transition-all duration-300 hover:border hover:shadow-md md:rounded-xl md:px-4 lg:px-6"
                >
                  <Image
                    src={category.imageUrl || ""}
                    alt={category.name}
                    width={34}
                    height={34}
                  />
                  <span className="text-sm font-medium text-gray-700 group-hover:text-gray-900 lg:text-base">
                    {category.name}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
