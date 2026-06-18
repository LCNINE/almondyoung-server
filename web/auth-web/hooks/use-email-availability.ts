"use client"

import { useEffect, useRef, useState } from "react"

import {
  checkEmailAvailableAction,
  type CheckEmailResult,
} from "@/app/actions"

const DEBOUNCE_MS = 400

export type EmailAvailabilityState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "available" }
  | { status: "taken" }
  | { status: "invalid"; message: string }
  | { status: "error"; message: string }

// 형식이 명백히 미완성인 값(예: 아직 @ 뒤를 입력 중)은 서버를 부르지 않는다.
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * 이메일 입력값을 debounce 하여 가입 가능 여부를 사전 확인한다.
 *
 * idle/checking 은 입력값에서 곧바로 파생하므로 effect 안에서 setState 하지 않는다.
 * 서버 응답만 비동기로 setState 하며, server action 은 POST RPC 라 응답 순서가 뒤바뀔 수
 * 있으므로 requestId 로 "마지막으로 보낸 요청"의 응답만 반영한다(latest-wins).
 */
export function useEmailAvailability(email: string): EmailAvailabilityState {
  const trimmed = email.trim()
  const looksValid = LOOKS_LIKE_EMAIL.test(trimmed)
  // 어떤 이메일 값에 대한 응답인지까지 기록해, 입력이 바뀐 뒤 도착한 stale 응답을 무시한다.
  const [result, setResult] = useState<{
    email: string
    state: CheckEmailResult
  } | null>(null)
  const latestRequestId = useRef(0)

  useEffect(() => {
    if (!looksValid) {
      latestRequestId.current += 1 // in-flight 응답 무효화
      return
    }

    const requestId = (latestRequestId.current += 1)
    const timer = setTimeout(async () => {
      let next: CheckEmailResult
      try {
        next = await checkEmailAvailableAction(trimmed)
      } catch {
        next = {
          status: "error",
          message: "이메일 확인 중 오류가 발생했어요. 잠시 후 다시 시도해주세요.",
        }
      }
      // 더 최신 요청이 떠난 상태면 이 응답은 버린다.
      if (requestId !== latestRequestId.current) return
      setResult({ email: trimmed, state: next })
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [trimmed, looksValid])

  // 표시 상태는 렌더 중 파생한다.
  if (!trimmed || !looksValid) return { status: "idle" }
  if (result?.email === trimmed) return result.state
  return { status: "checking" }
}
