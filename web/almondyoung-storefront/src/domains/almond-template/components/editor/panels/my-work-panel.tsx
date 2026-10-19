import { useEffect, useRef, useState, type ReactNode } from "react"
import { ChevronDown, MoreVertical, Pencil, Search, Trash2 } from "lucide-react"
import { formatTimeAgo } from "@/lib/utils/format-date"
import type { AlmondEditor } from "../../../hooks/use-almond-editor"
import type { SavedItem } from "../../../hooks/use-template-storage"
import { SavedThumbnail } from "../../saved-thumbnail"

const SORTS = [
  ["updated", "최근 수정 순"],
  ["titleAsc", "제목 오름차순"],
  ["titleDesc", "제목 내림차순"],
] as const

type Sort = (typeof SORTS)[number][0]

function sorted(items: SavedItem[], sort: Sort) {
  return [...items].sort((a, b) =>
    sort === "updated"
      ? b.updatedAt.localeCompare(a.updatedAt)
      : sort === "titleAsc"
        ? a.title.localeCompare(b.title, "ko")
        : b.title.localeCompare(a.title, "ko")
  )
}

function useOutsideClose(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) close()
    }
    document.addEventListener("pointerdown", onDown)
    return () => document.removeEventListener("pointerdown", onDown)
  }, [open, close])
  return ref
}

function MenuItem({
  children,
  onClick,
  selected = false,
}: {
  children: ReactNode
  onClick: () => void
  selected?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-[38px] w-full items-center justify-between rounded-[6px] px-[10px] text-left text-[14px] text-[#3F4250] hover:bg-[#F3F5F8] ${selected ? "bg-[#F6F7F9]" : ""}`}
    >
      {children}
    </button>
  )
}

export function MyWorkPanel({ editor }: { editor: AlmondEditor }) {
  const {
    mode,
    savedItems,
    savedId,
    refreshSaved,
    loadNamed,
    deleteNamed,
    togglePublished,
    storagePending,
    dirty,
  } = editor
  const designer = mode === "designer"
  const [sort, setSort] = useState<Sort>("updated")
  const [sortOpen, setSortOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState("")
  const [menuId, setMenuId] = useState<string | null>(null)
  const sortRef = useOutsideClose(sortOpen, () => setSortOpen(false))
  useEffect(() => {
    void refreshSaved()
    // 패널을 열 때마다 목록을 새로 받는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const items = sorted(
    savedItems.filter(
      (item) =>
        item.id !== savedId && (!searching || item.title.includes(query.trim()))
    ),
    sort
  )
  const open = (item: SavedItem) => {
    if (
      dirty &&
      !window.confirm(
        "저장하지 않은 변경사항이 있습니다. 다른 디자인을 열까요?"
      )
    )
      return
    void loadNamed(item)
  }
  return (
    <div className="-m-5">
      <div className="relative mx-5 mt-3 flex h-[37px] border-b border-[#E6E7EA]">
        <button
          type="button"
          className="px-2 py-[10px] text-[14px] leading-[16.71px] font-semibold text-[#20232A]"
        >
          {designer ? "내 시안" : "내 템플릿"}
        </button>
        <span className="absolute bottom-[-1px] left-0 h-[3px] w-[67px] bg-[#FEDE29] transition-all duration-300 ease-[ease]" />
      </div>
      <div className="mx-5 flex h-[46px] items-center gap-1 border-b border-[#E6E7EA]">
        {searching ? (
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="템플릿 제목으로 검색"
            aria-label="템플릿 제목으로 검색"
            className="h-[34px] w-[285px] rounded-[6px] border border-[#E0E1E5] pl-[11px] text-[13px] text-[#3F4250] outline-none"
          />
        ) : (
          <>
            <div ref={sortRef} className="relative">
              <button
                type="button"
                onClick={() => setSortOpen(!sortOpen)}
                className="flex items-center gap-1 rounded-[6px] bg-white pl-[10px] text-[13px] text-[#70777F]"
              >
                {SORTS.find(([id]) => id === sort)?.[1]}
                <ChevronDown
                  className={`size-3.5 ${sortOpen ? "rotate-180" : ""}`}
                />
              </button>
              {sortOpen && (
                <div className="absolute top-full left-0 z-20 mt-1 w-[130px] rounded-[6px] border border-[#E0E1E5] bg-white py-[10px] pr-[19px] pl-[10px]">
                  {SORTS.map(([id, label]) => (
                    <MenuItem
                      key={id}
                      selected={sort === id}
                      onClick={() => {
                        setSort(id)
                        setSortOpen(false)
                      }}
                    >
                      <span className="whitespace-nowrap">{label}</span>
                    </MenuItem>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
        <button
          type="button"
          aria-label="템플릿 검색"
          aria-pressed={searching}
          onClick={() => {
            setSearching(!searching)
            setQuery("")
          }}
          className="ml-auto flex size-[33px] shrink-0 items-center justify-center rounded-[6px] bg-[#F3F5F8]"
        >
          <Search className="size-4 text-[#3F4250]" />
        </button>
      </div>
      <ul className="grid grid-cols-2 gap-[15px] p-5 group-data-[wide]/panel:grid-cols-4">
        {items.map((item) => (
          <li
            key={item.id}
            className="group/card relative rounded-[5px] border border-[#F4F4F4] bg-[#FAFAFA] transition-[background-color] duration-200 hover:border-white hover:shadow-[0_0_0_2px_#FCDA3D]"
          >
            <div className="relative aspect-square overflow-hidden rounded-[5px] border-b border-[#F4F4F4]">
              <SavedThumbnail
                id={item.id}
                version={item.updatedAt}
                className="size-full bg-white"
              />
              <span className="pointer-events-none absolute inset-0 hidden bg-black/15 group-hover/card:block" />
              <button
                type="button"
                disabled={storagePending}
                onClick={() => open(item)}
                className="absolute inset-0 hidden items-center justify-center group-hover/card:flex"
              >
                <span className="flex h-[34px] items-center gap-1 rounded-[30px] bg-[#111] px-4 text-[14px] font-semibold text-white shadow-[2px_4px_4px_rgba(0,0,0,0.2)] transition-all duration-200">
                  편집하기 <Pencil className="size-3.5" />
                </span>
              </button>
            </div>
            <div className="px-[10px] pt-3 pb-[14px]">
              <strong className="block truncate text-[14px] font-bold text-[#333]">
                {item.title}
              </strong>
              <div className="mt-1 flex items-center justify-between">
                <em className="text-[12px] font-medium text-[#555] not-italic">
                  {formatTimeAgo(item.updatedAt)}
                </em>
                <button
                  type="button"
                  aria-label="추가 작업"
                  title="추가 작업"
                  onClick={() => setMenuId(menuId === item.id ? null : item.id)}
                  className="flex h-[25px] w-6 items-center justify-center text-[#555]"
                >
                  <MoreVertical className="size-4" />
                </button>
              </div>
            </div>
            {menuId === item.id && (
              <ul className="absolute top-full right-0 z-20 w-[170px] rounded-[5px] bg-white py-3 shadow-[1px_2px_8px_rgba(0,0,0,0.15)]">
                {designer && (
                  <li>
                    <button
                      type="button"
                      disabled={storagePending}
                      onClick={() => {
                        setMenuId(null)
                        void togglePublished(item)
                      }}
                      className="h-10 w-full pl-[52px] text-left text-[14px] font-medium text-[#555] hover:text-[#111]"
                    >
                      {item.status === "published" ? "게시 내리기" : "게시하기"}
                    </button>
                  </li>
                )}
                <li>
                  <button
                    type="button"
                    disabled={storagePending}
                    onClick={() => {
                      setMenuId(null)
                      if (window.confirm(`「${item.title}」을(를) 삭제할까요?`))
                        void deleteNamed(item)
                    }}
                    className="relative h-10 w-full pl-[52px] text-left text-[14px] font-medium text-[#555] hover:text-[#111]"
                  >
                    <Trash2 className="absolute top-1/2 left-5 size-4 -translate-y-1/2" />
                    삭제
                  </button>
                </li>
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
