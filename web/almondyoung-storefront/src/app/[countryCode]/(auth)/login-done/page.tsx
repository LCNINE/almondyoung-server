"use client"

import { useEffect } from "react"
import { useTranslations } from "next-intl"
import { AUTH_CHANNEL } from "@/domains/almond-template/hooks/use-auth-retry"

export default function LoginDonePage() {
  const t = useTranslations("account")
  useEffect(() => {
    const channel = new BroadcastChannel(AUTH_CHANNEL)
    channel.postMessage("signed-in")
    channel.close()
    window.close()
  }, [])
  return <p className="p-10 text-center text-sm">{t("loginDone")}</p>
}
