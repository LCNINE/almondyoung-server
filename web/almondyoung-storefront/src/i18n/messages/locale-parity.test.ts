import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * 세 로케일의 «키 집합»이 같은지 본다.
 *
 * 왜 필요한가: `next-intl` 메시지는 **타입 검사 대상이 아니다** — 이 트리엔 `IntlMessages`
 * 선언이 없어서 `t("없는키")` 도 `tsc` 를 그냥 통과한다. 게다가 `web/**` 는 CI 가 0개다
 * (#488 핸드오프 §2). 그래서 새 문구를 ko 에만 넣고 en·ja 를 빠뜨려도 **아무 게이트도
 * 안 잡고**, 그 로케일 사용자에게만 키 이름이 그대로 노출된다.
 *
 * 값이 아니라 키만 본다 — 번역이 아직 안 된 문구를 막을 방법은 없고, 막아서도 안 된다.
 */
const MESSAGES_DIR = dirname(fileURLToPath(import.meta.url))
const LOCALES = ["ko", "en", "ja"] as const
const REFERENCE = "ko"

function flatten(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return []
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return [path, ...flatten(child, path)]
  })
}

function keysOf(locale: string): string[] {
  const dir = join(MESSAGES_DIR, locale)
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .flatMap((file) => {
      const namespace = file.slice(0, -".json".length)
      const parsed = JSON.parse(readFileSync(join(dir, file), "utf8")) as unknown
      return flatten(parsed).map((k) => `${namespace}.${k}`)
    })
    .sort()
}

describe("i18n 메시지 로케일 대조", () => {
  const reference = keysOf(REFERENCE)

  it("기준 로케일에 키가 실제로 있다 — 아래 대조가 「빈 집합끼리 같다」로 공허해지지 않게", () => {
    expect(reference.length).toBeGreaterThan(100)
  })

  for (const locale of LOCALES.filter((l) => l !== REFERENCE)) {
    it(`${locale} 은 ${REFERENCE} 와 같은 키를 가진다`, () => {
      expect(keysOf(locale)).toEqual(reference)
    })
  }
})
