import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { SitePopup } from "@/lib/types/ui/site-popup"
import {
  DEFAULT_MOBILE_WIDTH,
  DEFAULT_PC_WIDTH,
  dismissPopup,
  isExternalLink,
  isPopupDismissed,
  matchesPath,
  resolvePopupSize,
  selectVisiblePopups,
  stripCountryCode,
} from "./site-popup.helpers"

function makePopup(overrides: Partial<SitePopup> = {}): SitePopup {
  return {
    id: "popup-1",
    title: "안내",
    contentType: "rich_text",
    content: "<p>본문</p>",
    pcImageFileId: null,
    mobileImageFileId: null,
    imageAlt: null,
    linkUrl: null,
    noticeId: null,
    pcWidth: null,
    pcHeight: null,
    mobileWidth: null,
    mobileHeight: null,
    placement: "main",
    placementPaths: [],
    audience: "all",
    dismissMode: "today",
    dismissDays: null,
    dismissVersion: 1,
    displayStartAt: null,
    displayEndAt: null,
    isActive: true,
    sortOrder: 0,
    deletedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  }
}

/** 테스트 환경(node)에는 window 가 없다 — 최소 localStorage 만 세운다. */
function installFakeStorage() {
  const store = new Map<string, string>()
  const localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size
    },
  }
  vi.stubGlobal("window", { localStorage })
  return store
}

describe("stripCountryCode", () => {
  it("국가 코드 접두사를 벗긴다", () => {
    expect(stripCountryCode("/kr/products/foo", "kr")).toBe("/products/foo")
  })

  it("국가 코드만 있는 경로는 루트로 본다", () => {
    expect(stripCountryCode("/kr", "kr")).toBe("/")
  })

  it("다른 국가 코드로 시작하는 경로는 건드리지 않는다", () => {
    expect(stripCountryCode("/krypton/foo", "kr")).toBe("/krypton/foo")
  })
})

describe("matchesPath", () => {
  it("전체 노출은 어느 경로에서나 뜬다", () => {
    const popup = makePopup({ placement: "all" })
    expect(matchesPath(popup, "/")).toBe(true)
    expect(matchesPath(popup, "/products/foo")).toBe(true)
  })

  it("메인 노출은 루트에서만 뜬다", () => {
    const popup = makePopup({ placement: "main" })
    expect(matchesPath(popup, "/")).toBe(true)
    expect(matchesPath(popup, "/products")).toBe(false)
  })

  it("경로 지정은 prefix 로 매칭한다", () => {
    const popup = makePopup({ placement: "paths", placementPaths: ["/products"] })
    expect(matchesPath(popup, "/products")).toBe(true)
    expect(matchesPath(popup, "/products/foo")).toBe(true)
    expect(matchesPath(popup, "/store")).toBe(false)
  })

  it("경로 앞부분 글자만 겹치는 다른 경로에는 뜨지 않는다", () => {
    const popup = makePopup({ placement: "paths", placementPaths: ["/product"] })
    expect(matchesPath(popup, "/products")).toBe(false)
  })
})

describe("다시 보지 않기", () => {
  beforeEach(() => {
    installFakeStorage()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("닫기 전에는 숨겨지지 않는다", () => {
    expect(isPopupDismissed(makePopup())).toBe(false)
  })

  it("오늘 하루 숨기면 같은 날에는 다시 뜨지 않는다", () => {
    const popup = makePopup({ dismissMode: "today" })
    dismissPopup(popup)
    expect(isPopupDismissed(popup)).toBe(true)
  })

  it("N일 숨김은 기간이 지나면 다시 뜬다", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-10T00:00:00.000Z"))

    const popup = makePopup({ dismissMode: "days", dismissDays: 3 })
    dismissPopup(popup)
    expect(isPopupDismissed(popup)).toBe(true)

    vi.setSystemTime(new Date("2026-08-12T00:00:00.000Z"))
    expect(isPopupDismissed(popup)).toBe(true)

    vi.setSystemTime(new Date("2026-08-14T00:00:00.000Z"))
    expect(isPopupDismissed(popup)).toBe(false)
  })

  it("숨김 사용 안 함이면 저장돼 있어도 매번 뜬다", () => {
    const popup = makePopup({ dismissMode: "today" })
    dismissPopup(popup)

    expect(isPopupDismissed({ ...popup, dismissMode: "none" })).toBe(false)
  })

  it("관리자가 숨김을 초기화하면 이미 닫은 사람에게도 다시 뜬다", () => {
    const popup = makePopup({ dismissVersion: 1 })
    dismissPopup(popup)
    expect(isPopupDismissed(popup)).toBe(true)

    expect(isPopupDismissed({ ...popup, dismissVersion: 2 })).toBe(false)
  })

  it("숨김 키가 팝업당 하나만 남아 쌓이지 않는다", () => {
    const store = installFakeStorage()
    const popup = makePopup({ dismissVersion: 1 })

    dismissPopup(popup)
    dismissPopup({ ...popup, dismissVersion: 2 })
    dismissPopup({ ...popup, dismissVersion: 3 })

    expect(Array.from(store.keys())).toEqual(["popup:popup-1:v3"])
  })

  it("다른 팝업의 숨김 기록은 지우지 않는다", () => {
    const store = installFakeStorage()

    dismissPopup(makePopup({ id: "popup-1" }))
    dismissPopup(makePopup({ id: "popup-2" }))

    expect(Array.from(store.keys()).sort()).toEqual(["popup:popup-1:v1", "popup:popup-2:v1"])
  })

  it("localStorage 를 못 쓰면 숨기지 않고 그냥 노출한다", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("blocked")
        },
        setItem: () => {
          throw new Error("blocked")
        },
        removeItem: () => undefined,
        key: () => null,
        length: 0,
      },
    })

    const popup = makePopup()
    expect(() => dismissPopup(popup)).not.toThrow()
    expect(isPopupDismissed(popup)).toBe(false)
  })
})

describe("selectVisiblePopups", () => {
  beforeEach(() => {
    installFakeStorage()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const none = new Set<string>()

  it("경로에 맞는 팝업만 고른다", () => {
    const main = makePopup({ id: "main", placement: "main" })
    const products = makePopup({
      id: "products",
      placement: "paths",
      placementPaths: ["/products"],
    })

    expect(selectVisiblePopups([main, products], "/", none)).toEqual([main])
    expect(selectVisiblePopups([main, products], "/products", none)).toEqual([
      products,
    ])
  })

  it("여러 개가 해당되면 받은 순서를 지킨다", () => {
    const first = makePopup({ id: "first", placement: "all" })
    const second = makePopup({ id: "second", placement: "all" })

    expect(
      selectVisiblePopups([first, second], "/", none).map((p) => p.id)
    ).toEqual(["first", "second"])
  })

  it("다시 보지 않기를 누른 팝업은 빼고 고른다", () => {
    const hidden = makePopup({ id: "hidden", placement: "all" })
    const shown = makePopup({ id: "shown", placement: "all" })
    dismissPopup(hidden)

    expect(selectVisiblePopups([hidden, shown], "/", none)).toEqual([shown])
  })

  // 레이아웃은 페이지를 옮겨도 살아있다. 닫은 팝업을 기억하지 않으면 이동할 때마다
  // 방금 닫은 팝업이 다시 뜬다.
  it("닫기만 누른 팝업은 다른 경로로 옮겨도 다시 뜨지 않는다", () => {
    const popup = makePopup({ id: "closed", placement: "all" })
    const closed = new Set(["closed"])

    expect(selectVisiblePopups([popup], "/", closed)).toEqual([])
    expect(selectVisiblePopups([popup], "/products", closed)).toEqual([])
  })
})

describe("resolvePopupSize", () => {
  it("크기를 비우면 기본 폭을 쓰고 높이는 자동이다", () => {
    const popup = makePopup()

    expect(resolvePopupSize(popup, true)).toEqual({
      width: DEFAULT_PC_WIDTH,
      height: null,
    })
    expect(resolvePopupSize(popup, false)).toEqual({
      width: DEFAULT_MOBILE_WIDTH,
      height: null,
    })
  })

  it("디바이스별로 지정한 크기를 쓴다", () => {
    const popup = makePopup({
      pcWidth: 700,
      pcHeight: 500,
      mobileWidth: 320,
      mobileHeight: 400,
    })

    expect(resolvePopupSize(popup, true)).toEqual({ width: 700, height: 500 })
    expect(resolvePopupSize(popup, false)).toEqual({ width: 320, height: 400 })
  })

  it("한쪽만 지정하면 나머지는 기본값으로 남는다", () => {
    const popup = makePopup({ pcWidth: 700 })

    expect(resolvePopupSize(popup, false)).toEqual({
      width: DEFAULT_MOBILE_WIDTH,
      height: null,
    })
  })
})

describe("isExternalLink", () => {
  it("http(s) 주소는 외부 링크다", () => {
    expect(isExternalLink("https://example.com")).toBe(true)
    expect(isExternalLink(" http://example.com ")).toBe(true)
  })

  it("사이트 내 경로는 외부 링크가 아니다", () => {
    expect(isExternalLink("/products/foo")).toBe(false)
  })
})
