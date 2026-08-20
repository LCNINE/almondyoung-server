import * as crypto from "crypto"

/**
 * storefront → wallet-web 핸드오프에서 Medusa 고객 토큰을 실어 나르는 봉투.
 * 원문을 폼 hidden input 으로 보내면 30일짜리 로그인 세션이 DOM 에 그대로 노출된다.
 *
 * ⚠️ 두 앱이 같은 구현·같은 CHECKOUT_HANDOFF_SECRET 을 써야 한다. 한쪽만 고치면
 * 핸드오프가 조용히 실패해 체크아웃 진입이 막힌다.
 */
const VERSION = "v1"
const ALGORITHM = "aes-256-gcm"
const TTL_MS = 60_000

// @types/node 버전이 두 앱에서 달라 Buffer 제네릭이 어긋난다. 바이트는 Uint8Array 로만 다룬다.
const u8 = (v: ArrayBufferView) =>
  new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength))
const b64 = (v: ArrayBufferView) => Buffer.from(u8(v)).toString("base64url")
const unb64 = (v: string) => u8(Buffer.from(v, "base64url"))

function key() {
  const secret = process.env.CHECKOUT_HANDOFF_SECRET
  if (!secret) throw new Error("CHECKOUT_HANDOFF_SECRET is not set")
  return u8(crypto.createHash("sha256").update(secret).digest())
}

export function sealMedusaToken(token: string, cartId: string): string {
  const iv = u8(crypto.randomBytes(12))
  const cipher = crypto.createCipheriv(ALGORITHM, key(), iv)
  const body = JSON.stringify({ t: token, c: cartId, e: Date.now() + TTL_MS })
  const sealed = b64(
    Buffer.concat([u8(cipher.update(body, "utf8")), u8(cipher.final())])
  )
  return [VERSION, b64(iv), b64(cipher.getAuthTag()), sealed].join(".")
}

/** 만료·카트 불일치·위조·키 불일치는 전부 null. */
export function unsealMedusaToken(sealed: string, cartId: string): string | null {
  const [version, iv, tag, body] = sealed.split(".")
  if (version !== VERSION || !iv || !tag || !body) return null

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key(), unb64(iv))
    decipher.setAuthTag(unb64(tag))
    const plain = Buffer.concat([
      u8(decipher.update(unb64(body))),
      u8(decipher.final()),
    ]).toString("utf8")

    const { t, c, e } = JSON.parse(plain) as { t: string; c: string; e: number }
    return t && c === cartId && Date.now() <= e ? t : null
  } catch {
    return null
  }
}
