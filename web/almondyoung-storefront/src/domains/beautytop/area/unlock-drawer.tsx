"use client"

import LocalizedClientLink from "@/components/shared/localized-client-link"
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer"
import { useTranslations } from "next-intl"

const UNLOCKS = ["rank", "peers", "prices", "changes"] as const

export function UnlockDrawer({
  open,
  onOpenChange,
  signedIn,
  loginHref,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  signedIn: boolean
  loginHref: string
}) {
  const t = useTranslations("beautytop.unlock")
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="border-0 bg-zinc-900 text-white">
        <div className="mx-auto w-full max-w-[640px]">
          <DrawerHeader className="gap-3 text-left">
            <span className="w-fit rounded-full border border-white/40 px-3 py-1 text-xs">MEMBERSHIP</span>
            <DrawerTitle className="text-[22px] leading-[30px] font-bold text-white">
              {t.rich("title", { em: (chunks) => <span className="text-primary">{chunks}</span> })}
            </DrawerTitle>
            <DrawerDescription className="text-sm text-white/60">{t("description")}</DrawerDescription>
          </DrawerHeader>
          <ul className="px-4">
            {UNLOCKS.map((key) => (
              <li key={key} className="flex justify-between gap-4 border-t border-zinc-700 py-3 text-sm">
                <span>{t(`item.${key}`)}</span>
                <b className="text-primary shrink-0">{t(`amount.${key}`)}</b>
              </li>
            ))}
          </ul>
          <DrawerFooter className="gap-2">
            <p className="text-[13px] text-white/60">{t("withDiscount")}</p>
            <LocalizedClientLink
              href={signedIn ? "/mypage/membership" : loginHref}
              className="bg-primary hover:bg-primary/90 flex h-[52px] items-center justify-center rounded-xl text-base font-bold text-white transition-colors duration-150"
            >
              {t(signedIn ? "start" : "login")}
            </LocalizedClientLink>
            <DrawerClose className="h-11 text-sm font-medium text-white/80 hover:text-white transition-colors duration-150">{t("later")}</DrawerClose>
          </DrawerFooter>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
