"use client"

export type BeautyTopQuery = {
  resource:
    | "shops"
    | "search"
    | "ranking"
    | "operating"
    | "price-comparison"
    | "activity"
    | "shop"
    | "position"
    | "briefing"
    | "changes"
    | "watch"
    | "leaders"
    | "prices"
    | "market"
    | "lifecycle"
    | "trends"
    | "revenue"
    | "franchise"
    | "options"
    | "analysis"
    | "map"
  page?: number
  page_size?: number
  after_id?: number
  [key: string]: string | number | undefined
}

export type BeautyTopResult<T> = {
  api_version: "1"
  resource: BeautyTopQuery["resource"]
  data: T
  pagination: null | {
    page: number | null
    page_size: number
    total: number
    total_pages: number
    has_next: boolean
    next_page: number | null
    next_after_id?: number | null
    mode?: "page" | "cursor"
  }
}

type Proof = { access_token: string; api_base_url: string; expires_in: number }

export type BeautyTopErrorCode =
  | "LOGIN_REQUIRED"
  | "MEMBERSHIP_REQUIRED"
  | "CONFIRMATION_REQUIRED"
  | "RATE_LIMITED"
  | "UNAVAILABLE"
  | "FAILED"

// Screens translate the code; the client never carries user-facing copy.
export class BeautyTopError extends Error {
  constructor(
    readonly code: BeautyTopErrorCode,
    /** Only with CONFIRMATION_REQUIRED: days left of the full-refund window, as the server counts them. */
    readonly withdrawalDaysRemaining: number | null = null
  ) {
    super(code)
    this.name = "BeautyTopError"
  }
}

const TOKEN_ERRORS: Record<number, BeautyTopErrorCode> = {
  401: "LOGIN_REQUIRED",
  403: "MEMBERSHIP_REQUIRED",
  409: "CONFIRMATION_REQUIRED",
  429: "RATE_LIMITED",
}

// Reused until shortly before expiry: issuing one per query cost a membership call per query.
const EXPIRY_MARGIN_MS = 10_000
let cached: { proof: Proof; until: number } | null = null
let pending: Promise<Proof> | null = null

export function forgetBeautyTopToken() {
  cached = null
}

async function issue(acknowledged: boolean): Promise<Proof> {
  const url = acknowledged
    ? "/api/beautytop/token?acknowledged=1"
    : "/api/beautytop/token"
  const call = () =>
    fetch(url, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
    })
  let response = await call()
  if (response.status === 401) {
    const restored = await fetch("/api/auth/restore-token", {
      method: "POST",
      credentials: "same-origin",
    })
    if (restored.ok) response = await call()
  }
  if (!response.ok) {
    const code = TOKEN_ERRORS[response.status] ?? "UNAVAILABLE"
    const body =
      code === "CONFIRMATION_REQUIRED"
        ? await response.json().catch(() => null)
        : null
    const days = body?.withdrawalDaysRemaining
    throw new BeautyTopError(code, typeof days === "number" ? days : null)
  }
  const proof = (await response.json()) as Proof
  cached = {
    proof,
    until: Date.now() + proof.expires_in * 1000 - EXPIRY_MARGIN_MS,
  }
  return proof
}

async function proof(): Promise<Proof> {
  if (cached && cached.until > Date.now()) return cached.proof
  // Share only concurrent requests. Tokens live in memory only — never localStorage, URLs or cookies.
  if (!pending)
    pending = issue(false).finally(() => {
      pending = null
    })
  return pending
}

/** Opens the premium view: throws CONFIRMATION_REQUIRED before anything is shown or recorded. */
export async function openPremium(): Promise<void> {
  await proof()
}

/** Called after the member agreed that opening ends the 7-day full-refund window. */
export async function acknowledgePremiumUse(): Promise<void> {
  cached = null
  await issue(true)
}

const MAX_IN_FLIGHT = 2
let inFlight = 0
const waiting: Array<() => void> = []

async function limited<T>(task: () => Promise<T>): Promise<T> {
  if (inFlight < MAX_IN_FLIGHT) inFlight++
  else await new Promise<void>((resolve) => waiting.push(resolve))
  try {
    return await task()
  } finally {
    const next = waiting.shift()
    if (next) next()
    else inFlight--
  }
}

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        reject(signal.reason)
      },
      { once: true }
    )
  })

export async function queryBeautyTop<T>(
  query: BeautyTopQuery,
  signal?: AbortSignal
): Promise<BeautyTopResult<T>> {
  let response = await send(await proof(), query, signal)
  if (response.status === 401) {
    // The cached token can be rejected early (clock skew, key rotation): get a fresh one once.
    cached = null
    response = await send(await proof(), query, signal)
  }
  for (let attempt = 1; response.status === 503 && attempt <= 3; attempt++) {
    await wait(400 * attempt, signal)
    response = await send(await proof(), query, signal)
  }
  if (!response.ok) {
    throw new BeautyTopError(
      response.status === 401
        ? "LOGIN_REQUIRED"
        : response.status === 429
          ? "RATE_LIMITED"
          : response.status === 503
            ? "UNAVAILABLE"
            : "FAILED"
    )
  }
  return response.json() as Promise<BeautyTopResult<T>>
}

function send(auth: Proof, query: BeautyTopQuery, signal?: AbortSignal) {
  const base = new URL(auth.api_base_url)
  if (base.protocol !== "https:" || base.username || base.password)
    throw new BeautyTopError("FAILED")
  const url = new URL("/v1/query", base)
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "")
      url.searchParams.set(key, String(value))
  }
  return limited(() =>
    fetch(url, {
      headers: { Authorization: `Bearer ${auth.access_token}` },
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      signal,
    })
  )
}
