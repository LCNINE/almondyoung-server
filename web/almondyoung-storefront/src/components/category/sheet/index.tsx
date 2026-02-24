"use client"

import { useUser } from "@/contexts/user-context"
import { Button } from "@components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@components/ui/sheet"
import { getCurrentSubscription } from "@lib/api/membership/client"
import { getCategoryTree } from "@lib/api/medusa/categories"
import { StoreProductCategoryTree } from "@lib/types/medusa-category"
import { CurrentSubscription } from "@lib/types/ui/membership"
import { UserDetail } from "@lib/types/ui/user"
import { cn } from "@lib/utils"
import { getThumbnailUrl } from "@lib/utils/get-thumbnail-url"
import { AlertCircle, ChevronRight, UserCircle2 } from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useEffect, useMemo, useState, useTransition } from "react"

interface CategorySheetProps {
  trigger: React.ReactNode
}

export function CategorySheet({ trigger }: CategorySheetProps) {
  const { countryCode } = useParams()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [categories, setCategories] = useState<StoreProductCategoryTree[]>([])
  const [activeRootId, setActiveRootId] = useState<string | null>(null)
  const [activePathIds, setActivePathIds] = useState<string[]>([])
  const [isError, setIsError] = useState(false)

  const { user } = useUser()

  useEffect(() => {
    if (!open || categories.length > 0) return

    startTransition(async () => {
      try {
        const list = await getCategoryTree()
        setCategories(list)
        if (list.length > 0) {
          setActiveRootId(list[0].id)
          setActivePathIds([list[0].id])
        }
        setIsError(false)
      } catch (err) {
        console.error(err)
        setIsError(true)
      }
    })
  }, [open, categories.length])

  const activeRoot = useMemo(
    () => categories.find((category) => category.id === activeRootId) || null,
    [categories, activeRootId]
  )

  const activePath = useMemo(
    () => buildPathFromIds(activeRoot, activePathIds),
    [activeRoot, activePathIds]
  )

  const currentNode = activePath[activePath.length - 1] || null
  const childCategories = currentNode?.category_children || []

  const onSelectRoot = (id: string) => {
    setActiveRootId(id)
    setActivePathIds([id])
  }

  const onSelectChild = (category: StoreProductCategoryTree) => {
    setActivePathIds((prev) => [...prev, category.id])
  }

  const onNavigatePath = (index: number) => {
    setActivePathIds((prev) => prev.slice(0, index + 1))
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger className="cursor-pointer" asChild>
        {trigger}
      </SheetTrigger>

      <SheetContent
        side="left"
        className="flex w-[85%] max-w-[400px] flex-col border-none bg-white p-0 outline-none"
      >
        {/* 상단 */}
        <SheetHeader className="p-0 text-left">
          <SheetTitle className="sr-only">카테고리 메뉴</SheetTitle>

          <div className="flex flex-col bg-white px-6 py-10">
            <User user={user} />
          </div>
          <div className="h-[8px] w-full bg-[#F2F2F7]" />
        </SheetHeader>

        <SheetDescription className="sr-only">
          카테고리 리스트 영역
        </SheetDescription>

        <div className="flex flex-1 overflow-hidden">
          {/* 좌측 카테고리 탭 */}
          <MainCategoryList
            categories={categories}
            activeTab={activeRootId}
            isError={isError}
            setActiveTab={onSelectRoot}
          />

          {/* 우측 카테고리 메인 영역 */}
          <SubCategoryList
            currentNode={currentNode}
            activePath={activePath}
            childCategories={childCategories}
            isPending={isPending}
            isError={isError}
            setOpen={setOpen}
            countryCode={countryCode as string}
            onSelectChild={onSelectChild}
            onNavigatePath={onNavigatePath}
          />
        </div>

        <SheetFooter className="flex flex-row items-center justify-between border-t border-gray-100 bg-white px-6 py-4">
          {/* 추후 카테고리 설정 버튼 추가 예정 */}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function MainCategoryList({
  categories,
  activeTab,
  isError,
  setActiveTab,
}: {
  categories: StoreProductCategoryTree[]
  activeTab: string | null
  isError: boolean
  setActiveTab: (id: string) => void
}) {
  return (
    <aside className="w-[110px] overflow-y-auto border-r border-gray-50 bg-[#F9F9F9]">
      {!isError &&
        categories.map((cat) => (
          <Button
            key={cat.id}
            variant="ghost"
            onClick={() => setActiveTab(cat.id)}
            className={cn(
              "relative w-full px-3 py-5 text-center text-[13px] leading-tight transition-all hover:bg-transparent",
              activeTab === cat.id
                ? "bg-white font-bold text-black hover:bg-white hover:text-black"
                : "text-gray-400 hover:text-gray-600"
            )}
          >
            {activeTab === cat.id && (
              <div className="absolute top-1/2 left-0 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-black" />
            )}
            {cat.name}
          </Button>
        ))}
    </aside>
  )
}

function SubCategoryList({
  currentNode,
  activePath,
  childCategories,
  isPending,
  isError,
  setOpen,
  countryCode,
  onSelectChild,
  onNavigatePath,
}: {
  currentNode: StoreProductCategoryTree | null
  activePath: StoreProductCategoryTree[]
  childCategories: StoreProductCategoryTree[]
  isPending: boolean
  isError: boolean
  setOpen: (open: boolean) => void
  countryCode: string
  onSelectChild: (category: StoreProductCategoryTree) => void
  onNavigatePath: (index: number) => void
}) {
  const currentPathSegments = activePath
    .map((node) => node.handle || node.id)
    .filter(Boolean)
  const currentHref =
    currentPathSegments.length > 0
      ? `/${countryCode}/category/${currentPathSegments.join("/")}`
      : `/${countryCode}`

  return (
    <main className="flex-1 overflow-y-auto bg-white px-5 py-7">
      {isPending && !currentNode ? (
        /* 로딩 상태 (스켈레톤) */
        <div className="flex animate-pulse flex-col gap-8">
          <div className="h-6 w-24 rounded bg-gray-100" />
          <div className="grid grid-cols-3 gap-x-4 gap-y-10">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="flex flex-col items-center gap-3">
                <div className="aspect-square w-full rounded-[22px] bg-gray-50" />
                <div className="h-3 w-10 rounded bg-gray-50" />
              </div>
            ))}
          </div>
        </div>
      ) : isError ? (
        /* 에러 상태 */
        <div className="flex h-full flex-col items-center justify-center text-center">
          <AlertCircle
            className="mb-4 h-10 w-10 text-red-200"
            strokeWidth={1.5}
          />

          <p className="mb-6 text-[12px] leading-relaxed text-gray-400">
            카테고리를 불러오는 중<br />
            에러가 발생했습니다.
          </p>
        </div>
      ) : (
        /* 정상 데이터 출력 */
        <>
          {activePath.length > 1 && (
            <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-gray-400">
              {activePath.map((node, index) => (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => onNavigatePath(index)}
                  className={cn(
                    "inline-flex items-center gap-1 hover:text-gray-700",
                    index === activePath.length - 1 && "font-semibold text-gray-600"
                  )}
                >
                  {index > 0 && <ChevronRight className="h-3 w-3 text-gray-500" />}
                  {node.name}
                </button>
              ))}
            </div>
          )}

          <div className="mb-8 flex items-center justify-between">
            <h3 className="text-[17px] font-bold tracking-tight">
              {currentNode?.name}
            </h3>

            <Button
              variant="link"
              asChild
              className="group flex items-center gap-0.5 px-0! text-[12px] font-semibold text-gray-400"
              onClick={() => setOpen(false)}
            >
              <Link href={currentHref}>
                전체보기
                <ChevronRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </Button>
          </div>

          <div className="grid grid-cols-3 gap-x-4 gap-y-10">
            {childCategories.map((child) => {
              const hasChildren = Boolean(child.category_children?.length)
              const childHandle = child.handle || child.id
              const childHref = `/${countryCode}/category/${[...currentPathSegments, childHandle].join("/")}`

              if (hasChildren) {
                return (
                  <button
                    key={child.id}
                    type="button"
                    onClick={() => onSelectChild(child)}
                    className="group flex h-full w-full flex-col items-center gap-3"
                  >
                    <CategoryThumb category={child} />
                    <span className="inline-flex items-center gap-0.5 text-center text-[11px] leading-[1.3] font-medium break-keep text-gray-600">
                      {child.name}
                      <ChevronRight className="h-3 w-3 text-gray-500" />
                    </span>
                  </button>
                )
              }

              return (
                <Button
                  key={child.id}
                  variant="link"
                  asChild
                  className="group flex h-full w-full flex-col items-center gap-3 px-0! py-0!"
                >
                  <Link href={childHref} onClick={() => setOpen(false)}>
                    <CategoryThumb category={child} />
                    <span className="text-center text-[11px] leading-[1.3] font-medium break-keep text-gray-600">
                      {child.name}
                    </span>
                  </Link>
                </Button>
              )
            })}
          </div>
        </>
      )}
    </main>
  )
}

function CategoryThumb({ category }: { category: StoreProductCategoryTree }) {
  const imageSrc = getCategoryImageSrc(category)

  return (
    <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-[22px] bg-[#F5F5F7] transition-transform duration-200 group-active:scale-95">
      {imageSrc ? (
        <img
          src={getThumbnailUrl(imageSrc)}
          alt={category.name}
          className="h-full w-full object-contain p-3.5"
        />
      ) : (
        <div className="h-6 w-6 rounded bg-gray-200/50" />
      )}
    </div>
  )
}

const buildPathFromIds = (
  root: StoreProductCategoryTree | null,
  pathIds: string[]
) => {
  if (!root || pathIds.length === 0 || pathIds[0] !== root.id) {
    return []
  }

  const path: StoreProductCategoryTree[] = [root]
  let level = root.category_children || []

  for (let i = 1; i < pathIds.length; i += 1) {
    const next = level.find((child) => child.id === pathIds[i])
    if (!next) {
      break
    }

    path.push(next)
    level = next.category_children || []
  }

  return path
}

const getCategoryImageSrc = (category: StoreProductCategoryTree) => {
  const metadata = category.metadata as
    | { imageUrl?: unknown; image_url?: unknown; image?: unknown }
    | null
    | undefined

  const image =
    metadata?.imageUrl || metadata?.image_url || metadata?.image || null

  return typeof image === "string" ? image : null
}

function User({ user }: { user: UserDetail | null }) {
  const [currentSubscription, setCurrentSubscription] =
    useState<CurrentSubscription | null>(null)

  useEffect(() => {
    if (!user) return

    getCurrentSubscription()
      .then(setCurrentSubscription)
      .catch(() => setCurrentSubscription(null))
  }, [user])

  const UserAvatar = user ? (
    // todo: 프로필 이미지
    <Link href="/mypage">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-50">
        <UserCircle2 className="h-8 w-8 text-gray-200" strokeWidth={1.5} />
      </div>
    </Link>
  ) : (
    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-50">
      <UserCircle2 className="h-8 w-8 text-gray-200" strokeWidth={1.5} />
    </div>
  )

  const MemberShip = currentSubscription?.status === "ACTIVE" ? (
    <Link
      href="/mypage/membership"
      className="text-[13px] font-medium text-yellow-600 underline-offset-4 hover:underline"
    >
      멤버십 혜택 적용 중
    </Link>
  ) : (
    <Link
      href="/mypage/membership"
      className="text-[13px] leading-tight font-medium text-gray-400 hover:underline hover:underline-offset-4"
    >
      혜택 가득한 서비스를 경험해보세요.
    </Link>
  )

  if (user) {
    return (
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h2 className="text-2xl leading-tight font-bold tracking-tight text-gray-900">
            {user.username}님,
            <br />
            반가워요!
          </h2>
          {MemberShip}
        </div>
        {UserAvatar}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Link href="/login" className="group flex items-center gap-1">
            <h2 className="text-2xl font-bold tracking-tight text-gray-900">
              로그인 해주세요
            </h2>
            <ChevronRight className="h-6 w-6 text-gray-300 transition-all group-hover:translate-x-1 group-hover:text-black" />
          </Link>
          {MemberShip}
        </div>
        {UserAvatar}
      </div>
      <div className="flex items-center gap-4 border-t border-gray-50 pt-4">
        <Link
          href="/signup"
          className="text-[13px] font-bold text-gray-900 underline underline-offset-4"
        >
          회원가입
        </Link>
      </div>
    </div>
  )
}
