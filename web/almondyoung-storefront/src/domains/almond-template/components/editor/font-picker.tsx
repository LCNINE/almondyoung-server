import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { createPortal } from "react-dom"
import {
  Check,
  ChevronDown,
  ChevronLeft,
  Heart,
  RotateCw,
  Search,
} from "lucide-react"
import {
  FONT_CATEGORIES,
  fontOptions,
  subscribeFontOptions,
  type FontCategory,
  type FontOption,
} from "../../lib/fonts"
import { Toggle } from "./prop-sections"

const FAVORITES = "almond-template-font-favorites"
const RECENT = "almond-template-font-recent"

// 브라우저마다 따로 기억하는 편의 기능이라, 저장소가 막혀도 목록은 그대로 뜬다
function readList(key: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "[]")
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}
function writeList(key: string, value: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {}
}

type Group = "recent" | "korean" | "uploaded"

// 망고보드 폰트 선택 화면: 속성 패널 위로 왼쪽에서 밀려 들어오고, 누르면 바로 적용되며 화면은 그대로 남는다
export function FontPicker({
  open,
  value,
  onPick,
  onClose,
  anchor,
  replaceSame,
  onReplaceSame,
}: {
  open: boolean
  value: string | null
  onPick: (family: string) => void
  onClose: () => void
  anchor: HTMLElement | null
  replaceSame?: boolean
  onReplaceSame?: (checked: boolean) => void
}) {
  const fonts = useSyncExternalStore(
    subscribeFontOptions,
    fontOptions,
    fontOptions
  )
  const [host, setHost] = useState<HTMLElement | null>(null)
  const [shown, setShown] = useState(false)
  const [query, setQuery] = useState("")
  const [styles, setStyles] = useState<FontCategory[]>([])
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [favorites, setFavorites] = useState<string[]>([])
  const [recent, setRecent] = useState<string[]>([])
  const [group, setGroup] = useState<Group>("korean")
  const [groupOpen, setGroupOpen] = useState(false)
  const search = useRef<HTMLInputElement>(null)

  // 패널을 접는 틀 안에 띄워야 패널을 접고 넓힐 때 같이 접힌다
  useLayoutEffect(() => {
    if (!open || !anchor) return
    setHost(
      anchor.closest<HTMLElement>("[data-tool-panel]")?.parentElement ?? null
    )
  }, [open, anchor])
  useEffect(() => {
    if (!open) return setShown(false)
    setFavorites(readList(FAVORITES))
    setRecent(readList(RECENT))
    // 한 프레임 뒤에 옮겨야 밀려 들어오는 전환이 보인다
    const frame = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(frame)
  }, [open])

  if (!open || !host) return null

  const uploaded = fonts.filter((font) => font.category === "내 글꼴")
  const builtIn = fonts.filter((font) => font.category !== "내 글꼴")
  const recentFonts = recent
    .map((v) => fonts.find((font) => font.value === v))
    .filter((font): font is FontOption => !!font)
  const groups: [Group, string, FontOption[]][] = [
    ["recent", "최근 사용 폰트", recentFonts],
    ["korean", "일반 폰트 - 한글", builtIn],
    ...(uploaded.length
      ? [["uploaded", "올린 글꼴", uploaded] as [Group, string, FontOption[]]]
      : []),
  ]
  const [, groupLabel, groupFonts] =
    groups.find(([id]) => id === group) ?? groups[1]
  const needle = query.trim().toLowerCase()
  const list = groupFonts.filter(
    (font) =>
      (!styles.length || styles.includes(font.category)) &&
      (!favoritesOnly || favorites.includes(font.value)) &&
      (!needle || font.label.toLowerCase().includes(needle))
  )
  const styleOptions = FONT_CATEGORIES.filter(
    (name) => name !== "내 글꼴" && builtIn.some((f) => f.category === name)
  )
  const pick = (font: FontOption) => {
    const next = [font.value, ...recent.filter((v) => v !== font.value)].slice(
      0,
      20
    )
    setRecent(next)
    writeList(RECENT, next)
    onPick(font.value)
  }
  const toggleFavorite = (font: FontOption) => {
    const next = favorites.includes(font.value)
      ? favorites.filter((v) => v !== font.value)
      : [...favorites, font.value]
    setFavorites(next)
    writeList(FAVORITES, next)
  }

  return createPortal(
    <div
      className="pointer-events-none absolute top-0 bottom-0 left-0 z-20 overflow-hidden"
      style={{ width: host.firstElementChild?.clientWidth ?? 360 }}
    >
      <div
        role="dialog"
        aria-label="폰트 선택"
        // 이 화면에서 누른 키는 편집기 단축키(방향키 이동·Delete 삭제)로 가지 않는다. Esc 는 이 화면만 닫는다
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === "Escape") onClose()
        }}
        className="pointer-events-auto absolute inset-0 flex flex-col bg-white pr-[23px] pl-[14px] transition-transform duration-500 ease-[ease]"
        style={{ transform: shown ? "translateX(0)" : "translateX(-100%)" }}
      >
        <div className="mb-[15px] flex h-[60px] shrink-0 items-center border-b border-[#e6e7ea]">
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1 text-[16px] font-medium text-[#20232A]"
          >
            <ChevronLeft size={20} />
            전체 폰트
          </button>
        </div>
        <label className="relative block shrink-0">
          <input
            ref={search}
            value={query}
            placeholder="폰트명을 입력하세요"
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setQuery(event.target.value)}
            className="h-[38px] w-full rounded-[6px] border border-[#e0e1e5] pr-9 pl-[10px] text-[14px] font-bold text-[#3F4250] outline-none placeholder:font-normal placeholder:text-[#AAACB0]"
          />
          <Search
            size={16}
            className="absolute top-1/2 right-[10px] -translate-y-1/2 text-[#70777F]"
          />
        </label>
        <div className="mt-[15px] flex shrink-0 items-center border-b border-[#e6e7ea]">
          <span className="relative px-2 py-[10px] text-[14px] font-semibold text-[#20232A]">
            스타일
            <span className="absolute right-0 bottom-[-1px] left-0 h-[3px] bg-[#fede29]" />
          </span>
          <button
            type="button"
            aria-label="필터 초기화"
            title="초기화"
            disabled={!styles.length}
            onClick={() => setStyles([])}
            className="ml-auto flex size-[26px] items-center justify-center rounded-[6px] text-[#70777F] hover:bg-[#F3F5F8] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <RotateCw size={15} />
          </button>
        </div>
        <div className="flex shrink-0 flex-wrap gap-[5px] py-[15px]">
          {styleOptions.map((name) => {
            const on = styles.includes(name)
            return (
              <button
                key={name}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setStyles(
                    on ? styles.filter((s) => s !== name) : [...styles, name]
                  )
                }
                className={`h-7 rounded-[5px] border px-[10px] text-[13px] transition-[border-color] duration-500 ${on ? "border-[#fede29] font-medium text-[#20232A]" : "border-transparent text-[#70777F]"}`}
              >
                {name}
              </button>
            )
          })}
        </div>
        <div className="shrink-0 border-t border-[#e6e7ea] pt-[12px] pb-[15px]">
          <Toggle
            label="즐겨찾기 폰트만 보기"
            checked={favoritesOnly}
            onChange={setFavoritesOnly}
          />
        </div>
        <div className="relative shrink-0">
          <button
            type="button"
            aria-expanded={groupOpen}
            onClick={() => setGroupOpen(!groupOpen)}
            className="flex h-10 w-full items-center rounded-[7px] bg-[#e5e9ef] px-3 text-[14px] text-[#20232A]"
          >
            {groupLabel}
            <span className="ml-1 text-[#70777F]">{groupFonts.length}</span>
            <ChevronDown
              size={16}
              className={`ml-auto transition-transform duration-150 ${groupOpen ? "rotate-180" : ""}`}
            />
          </button>
          {groupOpen && (
            <div className="absolute top-full right-0 left-0 z-10 mt-1 grid grid-cols-2 gap-1 rounded-[6px] border border-[#e0e1e5] bg-white p-[6px]">
              {groups.map(([id, label, items]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setGroup(id)
                    setGroupOpen(false)
                  }}
                  className={`flex h-[38px] items-center rounded-[6px] px-[10px] text-left text-[13px] text-[#3F4250] hover:bg-[#F3F5F8] ${group === id ? "bg-[#f6f7f9]" : ""}`}
                >
                  {label}
                  <span className="ml-1 text-[#AAACB0]">{items.length}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <ul
          role="listbox"
          aria-label="폰트 목록"
          className="mt-[6px] min-h-0 flex-1 overflow-y-auto"
        >
          {list.map((font) => {
            const selected = font.value === value
            const favorite = favorites.includes(font.value)
            return (
              <li
                key={font.value}
                className={`group/font my-[3px] flex h-10 items-center gap-1 rounded-[6px] py-[9px] pr-[5px] pl-[7px] hover:bg-[#f6f7f9] ${selected ? "bg-[#f6f7f9]" : ""}`}
              >
                <button
                  type="button"
                  aria-label={`${font.label} 즐겨찾기`}
                  aria-pressed={favorite}
                  onClick={() => toggleFavorite(font)}
                  className={`flex size-5 shrink-0 items-center justify-center ${favorite ? "text-[#FE6767]" : "text-[#AAACB0] opacity-0 group-hover/font:opacity-100 focus-visible:opacity-100"}`}
                >
                  <Heart size={15} fill={favorite ? "currentColor" : "none"} />
                </button>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => pick(font)}
                  className="flex min-w-0 flex-1 items-center gap-[3px] text-left"
                >
                  <span
                    className="min-w-0 flex-1 truncate text-[17px] text-[#20232A]"
                    style={{ fontFamily: font.value }}
                  >
                    {font.label}
                  </span>
                  {font.category !== "내 글꼴" && (
                    <>
                      <span className="flex size-[22px] shrink-0 items-center justify-center rounded-[5px] bg-[#FEE869] text-[11px] text-[#3F4250]">
                        한
                      </span>
                      <span className="flex size-[22px] shrink-0 items-center justify-center rounded-[5px] bg-[#E6E0FA] text-[11px] text-[#3F4250]">
                        En
                      </span>
                    </>
                  )}
                  <Check
                    size={16}
                    className={`ml-1 shrink-0 text-[#20232A] ${selected ? "" : "invisible"}`}
                  />
                </button>
              </li>
            )
          })}
          {!list.length && (
            <li className="py-10 text-center text-[13px] text-[#AAACB0]">
              {favoritesOnly
                ? "즐겨찾기한 폰트가 없습니다. 폰트 앞 ♡ 를 눌러 담아 보세요."
                : group === "recent"
                  ? "최근 사용한 폰트가 없습니다."
                  : "조건에 맞는 폰트가 없습니다."}
            </li>
          )}
        </ul>
        {onReplaceSame && (
          <label className="flex shrink-0 items-center gap-2 border-t border-[#e6e7ea] py-[15px] text-[14px] text-[#3F4250]">
            <input
              type="checkbox"
              checked={!!replaceSame}
              onChange={(event) => onReplaceSame(event.target.checked)}
              className="size-[18px] accent-[#fede29]"
            />
            같은 폰트 모두 변경
          </label>
        )}
      </div>
    </div>,
    host
  )
}
