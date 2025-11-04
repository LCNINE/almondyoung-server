// --- 1. 데이터 ---
import Image from "next/image"
import Link from "next/link"

// 실제로는 API에서 받아오거나 상위에서 props로 전달받습니다.
const categories = [
  {
    id: 1,
    name: "네일 스티커",
    imageUrl: "https://picsum.photos/250/250",
    href: "/category/nail-stickers",
  },
  {
    id: 2,
    name: "젤네일",
    imageUrl: "https://picsum.photos/250/250",
    href: "/category/gel-nails",
  },
  {
    id: 3,
    name: "정품 오스트리아 스톤",
    imageUrl: "https://picsum.photos/250/250",
    href: "/category/stones",
  },
  {
    id: 4,
    name: "네일 글리터",
    imageUrl: "https://picsum.photos/250/250",
    href: "/category/glitter",
  },
  {
    id: 5,
    name: "네일 파츠",
    imageUrl: "https://picsum.photos/250/250",
    href: "/category/parts",
  },
  {
    id: 6,
    name: "네일 재료",
    imageUrl: "https://picsum.photos/250/250",
    href: "/category/materials",
  },
  {
    id: 7,
    name: "네일기계",
    imageUrl: "https://picsum.photos/250/250",
    href: "/category/machines",
  },
  // ... (더 많은 카테고리)
]

// --- 2. 개별 아이템 컴포넌트 ---
interface CategoryItemProps {
  name: string
  imageUrl: string
  href: string
}

function SubCategoryItem({ name, imageUrl, href }: CategoryItemProps) {
  return (
    <li className="w-1/2 sm:w-1/3 md:w-1/4 lg:w-1/6">
      <Link
        href={href}
        className="flex flex-col items-center gap-3 p-2.5 font-['Pretendard']"
      >
        <div className="flex aspect-square w-full items-center justify-center rounded-full bg-gray-200 p-3.5">
          <Image
            src={imageUrl}
            alt={`${name} 카테고리`}
            width={117}
            height={117}
            className="h-full w-full rounded-full object-cover"
          />
        </div>

        <p className="text-Labels-Primary min-h-11 w-full text-center text-lg leading-snug font-semibold">
          {name}
        </p>
      </Link>
    </li>
  )
}

// --- 3. 메인 그리드 컴포넌트 ---
export function CategorySubList() {
  return (
    // PARENT (List):
    // - 시맨틱한 <ul> 태그를 사용합니다.
    // - flex-wrap: 원본의 핵심 레이아웃을 유지합니다.
    // - self-stretch: 원본의 스타일을 유지합니다.
    <ul className="hidden flex-wrap self-stretch md:flex">
      {categories.map((category) => (
        <SubCategoryItem
          key={category.id}
          name={category.name}
          imageUrl={category.imageUrl}
          href={category.href}
        />
      ))}
    </ul>
  )
}
