"use client"

import { useEffect, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Link2, X } from "lucide-react"
import Image from "next/image"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import { CustomButton } from "@/components/shared/custom-buttons"
import { Button } from "@/components/ui/button"
import { getCafe24LinkInfo } from "@/lib/api/users/cafe24"

const CAFE24_MIGRATOR_BASE = "https://almondyoung.com/migrator/confirm.html"
const STORAGE_KEY = "home:cafe24-link-banner:v1:hideUntil"

interface Cafe24LinkBannerProps {
  countryCode: string
}

export function Cafe24LinkBanner({ countryCode }: Cafe24LinkBannerProps) {
  const t = useTranslations("home.cafe24Link")
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const hideUntil = localStorage.getItem(STORAGE_KEY)
    if (hideUntil && Date.now() < Number(hideUntil)) return

    getCafe24LinkInfo().then((result) => {
      const alreadyLinked = "data" in result && !!result.data
      if (!alreadyLinked) setVisible(true)
    })
  }, [])

  const handleDismiss = () => {
    const endOfDay = new Date()
    endOfDay.setHours(23, 59, 59, 999)
    localStorage.setItem(STORAGE_KEY, String(endOfDay.getTime()))
    setVisible(false)
  }

  const handleLink = () => {
    const postUrl = `${window.location.origin}/${countryCode}/mypage/account/cafe24/confirm`
    window.location.href = `${CAFE24_MIGRATOR_BASE}?redirect_to=${encodeURIComponent(postUrl)}`
  }

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className={cn(
            "fixed right-0 left-0 z-999",
            "pb-safe bottom-20 px-3",
            "md:bottom-0 md:px-6 md:pb-6"
          )}
        >
          {/* 모바일 레이아웃 */}
          <div
            className={cn(
              "mx-auto max-w-lg md:hidden",
              "rounded-xl bg-white/95 backdrop-blur-lg",
              "border border-gray-200/50",
              "shadow-[0_4px_20px_rgba(0,0,0,0.1)]",
              "px-4 py-3"
            )}
          >
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 shrink-0">
                <Image
                  src="/images/logo.webp"
                  alt={t("logoAlt")}
                  width={36}
                  height={36}
                  className="h-full w-full object-contain"
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[12.2px] font-medium text-gray-900">
                  {t("mobileText")}
                </p>
              </div>
              <CustomButton
                size="sm"
                rounded="full"
                className="h-auto shrink-0 px-3.5 py-1.5 text-[12px]"
                onClick={handleLink}
              >
                <Link2 className="h-3 w-3" />
                {t("link")}
              </CustomButton>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={handleDismiss}
                className="h-8 w-8 shrink-0 rounded-full text-gray-400 hover:text-gray-600"
                aria-label={t("dismiss")}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* 데스크탑 레이아웃 */}
          <div
            className={cn(
              "relative mx-auto hidden max-w-lg md:block",
              "rounded-2xl bg-white/80 backdrop-blur-xl",
              "border border-gray-200/50",
              "shadow-[0_8px_30px_rgba(0,0,0,0.12)]",
              "p-5"
            )}
          >
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleDismiss}
              className="absolute top-3 right-3 h-8 w-8 rounded-full text-gray-400 hover:text-gray-600"
              aria-label={t("dismiss")}
            >
              <X className="h-4 w-4" />
            </Button>

            <div className="flex items-start gap-4">
              <div className="h-10 w-10 shrink-0">
                <Image
                  src="/images/logo.webp"
                  alt={t("logoAlt")}
                  width={40}
                  height={40}
                  className="h-full w-full object-contain"
                />
              </div>
              <div className="min-w-0 flex-1 pr-4">
                <h3 className="text-[15px] font-semibold tracking-tight text-gray-900">
                  {t("desktopTitle")}
                </h3>
                <p className="mt-1 text-[13px] leading-relaxed text-gray-500">
                  {t("desktopDescription")}
                </p>
                <div className="mt-3">
                  <CustomButton size="sm" rounded="full" onClick={handleLink}>
                    <Link2 className="h-3.5 w-3.5" />
                    {t("link")}
                  </CustomButton>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
