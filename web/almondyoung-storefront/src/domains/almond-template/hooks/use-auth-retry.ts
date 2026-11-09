import { unstable_isUnrecognizedActionError } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { createBrowserLogger } from "@packages/web-observability/browser"

export const AUTH_CHANNEL = "almond-template-auth"

let restoring: Promise<boolean> | undefined

function restoreToken() {
  restoring ??= fetch("/api/auth/restore-token", {
    method: "POST",
    credentials: "include",
  })
    .then((response) => response.ok)
    .catch(() => false)
    .finally(() => {
      restoring = undefined
    })
  return restoring
}

const REFRESH_BEFORE_SECONDS = 5 * 60
const CHECK_INTERVAL_MS = 4 * 60 * 1000

// 편집기는 한 페이지에 오래 머물러 미들웨어 갱신이 안 일어나므로, 만료 5분 전이면 미리 갱신한다.
// restore-token 은 호출마다 refresh 토큰을 회전시키므로 만료가 가까울 때만 부른다.
async function refreshIfExpiring() {
  try {
    const response = await fetch("/api/auth/session", { cache: "no-store" })
    const { expiresIn, refreshable } = (await response.json()) as {
      expiresIn: number | null
      refreshable: boolean
    }
    if (
      refreshable &&
      (expiresIn === null || expiresIn < REFRESH_BEFORE_SECONDS)
    )
      await restoreToken()
  } catch {
    return
  }
}

export function isUnauthorized(error: unknown) {
  const err = error as { digest?: string; message?: string } | undefined
  return err?.digest === "UNAUTHORIZED" || err?.message === "UNAUTHORIZED"
}

// 배포 전에 연 탭은 서버 액션 id 가 달라 저장·업로드가 전부 실패한다
export function failureMessage(error: unknown, failure: string) {
  if (unstable_isUnrecognizedActionError(error))
    return "사이트가 업데이트되어 이 화면에서는 처리할 수 없습니다. 새로고침 후 다시 시도해 주세요. 저장하지 않은 작업은 사라집니다."

  return failure
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// 네트워크가 잠깐 끊기거나 서버가 순간 응답하지 못한 실패는 다시 보내면 대개 성공한다.
// 로그인 만료·배포 전 탭은 다시 보내도 같으므로 바로 넘긴다
export async function retryTransient<T>(run: () => Promise<T>, attempts = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run()
    } catch (error) {
      if (
        attempt >= attempts ||
        isUnauthorized(error) ||
        unstable_isUnrecognizedActionError(error)
      )
        throw error
      await wait(600 * attempt)
    }
  }
}

type Task = () => Promise<void>

const logger = createBrowserLogger({ component: "almond-template.editor" })
const failureContext = new WeakMap<object, Record<string, unknown>>()

// 화면에는 묶음 문구만 보이므로, 어느 단계에서 무엇이 실패했는지는 로그로만 남는다
export function withFailureContext(
  error: unknown,
  context: Record<string, unknown>
) {
  if (error && typeof error === "object" && !failureContext.has(error))
    failureContext.set(error, context)
  return error
}

export function reportThumbnailFallback(error: unknown) {
  logger.warn("almond_template.thumbnail_fallback", { error })
}

function reportFailure(error: unknown, failure: string) {
  logger.error("almond_template.task_failed", {
    error,
    attributes: {
      failure,
      ...(error && typeof error === "object"
        ? failureContext.get(error)
        : undefined),
    },
  })
}

export function useAuthRetry(setMessage: (message: string) => void) {
  const [authRequired, setAuthRequired] = useState(false)
  const pending = useRef<{ task: Task; failure: string } | null>(null)

  const attempt = async (task: Task) => {
    try {
      await task()
      return true
    } catch (error) {
      if (!isUnauthorized(error)) throw error
    }
    if (await restoreToken()) {
      try {
        await task()
        return true
      } catch (error) {
        if (!isUnauthorized(error)) throw error
      }
    }
    return false
  }

  const runAuthed = async (task: Task, failure: string) => {
    try {
      if (await attempt(task)) return
      pending.current = { task, failure }
      setAuthRequired(true)
    } catch (error) {
      reportFailure(error, failure)
      setMessage(failureMessage(error, failure))
    }
  }

  const retryPending = async () => {
    const current = pending.current
    if (!current) return
    try {
      if (await attempt(current.task)) {
        pending.current = null
        setAuthRequired(false)
      }
    } catch (error) {
      pending.current = null
      setAuthRequired(false)
      reportFailure(error, current.failure)
      setMessage(failureMessage(error, current.failure))
    }
  }

  useEffect(() => {
    if (!authRequired) return
    const onFocus = () => void retryPending()
    const channel = new BroadcastChannel(AUTH_CHANNEL)
    channel.onmessage = onFocus
    window.addEventListener("focus", onFocus)
    return () => {
      channel.close()
      window.removeEventListener("focus", onFocus)
    }
  }, [authRequired])

  useEffect(() => {
    const check = () => {
      if (document.visibilityState === "visible") void refreshIfExpiring()
    }
    check()
    const timer = setInterval(check, CHECK_INTERVAL_MS)
    document.addEventListener("visibilitychange", check)
    return () => {
      clearInterval(timer)
      document.removeEventListener("visibilitychange", check)
    }
  }, [])

  const dismissAuth = () => {
    pending.current = null
    setAuthRequired(false)
  }

  return { authRequired, runAuthed, retryPending, dismissAuth }
}
