"use client"

import { useUser } from "@/contexts/user-context"
import { getFirebaseMessaging } from "@/lib/firebase/firebase"
import { registerFcmToken, deactivateFcmToken } from "@/lib/actions/notification"
import { getToken, onMessage } from "firebase/messaging"
import { useEffect, useRef, useTransition } from "react"

function getWebDeviceId(): string {
  const key = "_ay_did"
  let id = localStorage.getItem(key)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(key, id)
  }
  return id
}

export function PushNotificationProvider() {
  const { user } = useUser()
  const tokenRef = useRef<string | null>(null)
  const [, startTransition] = useTransition()

  useEffect(() => {
    if (!user) return

    let unsubscribeForeground: (() => void) | undefined
    let cancelled = false

    async function setup() {
      if (!("serviceWorker" in navigator) || !("Notification" in window)) return

      const permission = await Notification.requestPermission()
      if (permission !== "granted" || cancelled) return

      const messaging = await getFirebaseMessaging()
      if (!messaging || cancelled) return

      let swReg: ServiceWorkerRegistration
      try {
        swReg = await navigator.serviceWorker.register("/firebase-messaging-sw.js", {
          scope: "/",
        })
      } catch {
        return
      }

      let token: string
      try {
        token = await getToken(messaging, {
          vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
          serviceWorkerRegistration: swReg,
        })
      } catch {
        return
      }

      if (cancelled) return

      tokenRef.current = token

      startTransition(async () => {
        try {
          await registerFcmToken({
            token,
            platform: "web",
            deviceId: getWebDeviceId(),
          })
        } catch {
          // 토큰 등록 실패는 비중요 — 앱 기능에 영향 없음
        }
      })

      unsubscribeForeground = onMessage(messaging, (payload) => {
        const { title, body, icon } = payload.notification || {}
        if (Notification.permission === "granted") {
          new Notification(title || "알림", {
            body,
            icon: icon || "/android-chrome-192x192.png",
          })
        }
      })
    }

    setup()

    return () => {
      cancelled = true
      unsubscribeForeground?.()
    }
  }, [user?.id])

  useEffect(() => {
    if (user) return
    const token = tokenRef.current
    if (!token) return
    tokenRef.current = null

    startTransition(async () => {
      try {
        await deactivateFcmToken(token)
      } catch {
        // 로그아웃 시 토큰 비활성화 실패는 무시
      }
    })
  }, [user])

  return null
}
