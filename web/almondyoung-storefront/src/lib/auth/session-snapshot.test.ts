import { expect, it } from "vitest"

import { describeSentSession } from "./session-snapshot"

const jwt = (claims: Record<string, unknown>) =>
  `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`

it("같은 이름 쿠키를 모두 세고 값 대신 주인과 발급 시각만 남긴다", () => {
  const header = [
    `accessToken=${jwt({ sub: "old-user", iat: 100 })}`,
    "refreshToken=secret-a",
    `accessToken=${jwt({ sub: "new-user", iat: 200 })}`,
    "refreshToken=secret-b",
    `_medusa_jwt=${jwt({ actor_id: "cus_1", iat: 300 })}`,
    "_medusa_cache_id=x",
  ].join("; ")

  const snapshot = describeSentSession(header)

  expect(snapshot.sent_access).toBe("old-user@100,new-user@200")
  expect(snapshot.sent_medusa).toBe("cus_1@300")
  expect(snapshot.sent_refresh.split(",")).toHaveLength(2)
  expect(JSON.stringify(snapshot)).not.toContain("secret")
  expect(snapshot.sent_cache_id).toBe(1)
  expect(snapshot.sent_count).toBe(6)
})

it("쿠키가 없으면 빈 요약", () => {
  expect(describeSentSession(null)).toEqual({
    sent_count: 0,
    sent_bytes: 0,
    sent_access: "",
    sent_refresh: "",
    sent_medusa: "",
    sent_cache_id: 0,
  })
})
