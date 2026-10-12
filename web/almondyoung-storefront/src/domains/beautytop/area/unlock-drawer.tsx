"use client"

import LocalizedClientLink from "@/components/shared/localized-client-link"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import type { InsightQuestion } from "../components/insight-questions"
import { useTranslations } from "next-intl"

const UNLOCKS = ["rank", "peers", "prices", "changes"] as const

export function UnlockDrawer({
  open,
  onOpenChange,
  signedIn,
  loginHref,
  question = "reviews",
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  signedIn: boolean
  loginHref: string
  question?: InsightQuestion
}) {
  const t = useTranslations("beautytop.unlock")
  const insight = useTranslations("beautytop.insights")
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="border-border bg-background text-foreground">
        <div className="mx-auto w-full max-w-[640px]">
          <DrawerHeader className="gap-3 text-left">
            <span className="border-border w-fit rounded-full border px-3 py-1 text-xs">
              {insight("memberLabel")}
            </span>
            <DrawerTitle className="text-foreground text-[22px] leading-[30px] font-bold">
              {insight(`${question}.question`)}
            </DrawerTitle>
            <DrawerDescription className="text-muted-foreground text-sm">
              {insight(`${question}.why`)}
            </DrawerDescription>
          </DrawerHeader>
          <p className="bg-muted mx-4 mb-4 rounded-xl p-4 text-sm leading-5">
            {insight("membershipBridge")}
          </p>
          <ul className="px-4">
            {UNLOCKS.map((key) => (
              <li
                key={key}
                className="border-border flex justify-between gap-4 border-t py-3 text-sm"
              >
                <span>{t(`item.${key}`)}</span>
                <b className="text-foreground shrink-0">{t(`amount.${key}`)}</b>
              </li>
            ))}
          </ul>
          <DrawerFooter className="gap-2">
            <p className="text-muted-foreground text-[13px]">
              {t("withDiscount")}
            </p>
            <LocalizedClientLink
              href={signedIn ? "/mypage/membership" : loginHref}
              className="bg-primary hover:bg-primary/90 flex h-[52px] items-center justify-center rounded-xl text-base font-bold text-white transition-colors duration-150 motion-reduce:transition-none motion-reduce:duration-0"
            >
              {t(signedIn ? "start" : "login")}
            </LocalizedClientLink>
            <DrawerClose className="text-muted-foreground hover:text-foreground h-11 text-sm font-medium transition-colors duration-150 motion-reduce:transition-none motion-reduce:duration-0">
              {t("later")}
            </DrawerClose>
          </DrawerFooter>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
