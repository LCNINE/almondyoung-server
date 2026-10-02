import { useEffect, useRef, useState } from "react"

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

type Task = () => Promise<void>

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
    } catch {
      setMessage(failure)
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
    } catch {
      pending.current = null
      setAuthRequired(false)
      setMessage(current.failure)
    }
  }

  useEffect(() => {
    if (!authRequired) return
    const onFocus = () => void retryPending()
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
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
