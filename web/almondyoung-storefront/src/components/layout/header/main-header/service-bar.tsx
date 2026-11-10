import { LanguageSwitcher } from "@/components/layout/header/language-switcher"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { cn } from "@/lib/utils"
import { ChartNoAxesColumn } from "lucide-react"
import { getTranslations } from "next-intl/server"
import Image from "next/image"
import {
  ALMOND_TEMPLATE_HREF,
  ALMOND_TEMPLATE_IMAGE_URL,
  ALMOND_YOUNG_PLAY_IMAGE_URL,
  ALMOND_YOUNG_PLAY_URL,
  BEAUTY_EXAM_IMAGE_URL,
  BEAUTY_EXAM_URL,
  BEAUTYTOP_HREF,
  DABEAU_IMAGE_URL,
  DABEAU_URL,
} from "../header-links"
import { UserInfo } from "./user-info"

type ServiceLink = {
  key: string
  label: string
  href: string
  imageUrl: string | null
  external?: boolean
  isNew?: boolean
  wide?: boolean
}

const ITEM_CLASS_NAME =
  "relative flex h-7 items-center gap-1.5 rounded-full px-2.5 font-semibold text-gray-700 transition-colors hover:bg-white hover:text-foreground"

export async function ServiceBar() {
  const t = await getTranslations("header")

  const links: ServiceLink[] = [
    {
      key: "almondyoung-play",
      label: t("serviceBar.almondYoungPlay"),
      href: ALMOND_YOUNG_PLAY_URL,
      imageUrl: ALMOND_YOUNG_PLAY_IMAGE_URL,
      external: true,
      wide: true,
    },
    {
      key: "dabeau",
      label: t("serviceBar.dabeau"),
      href: DABEAU_URL,
      imageUrl: DABEAU_IMAGE_URL,
      external: true,
    },
    {
      key: "beauty-exam",
      label: t("serviceBar.beautyExam"),
      href: BEAUTY_EXAM_URL,
      imageUrl: BEAUTY_EXAM_IMAGE_URL,
      external: true,
      isNew: true,
    },
    {
      key: "beautytop",
      label: t("quickLinks.beautytop"),
      href: BEAUTYTOP_HREF,
      imageUrl: null,
      isNew: true,
    },
    {
      key: "almond-template",
      label: t("utility.almondTemplate"),
      href: ALMOND_TEMPLATE_HREF,
      imageUrl: ALMOND_TEMPLATE_IMAGE_URL,
    },
  ]

  return (
    <div className="bg-muted hidden border-b border-gray-200 text-xs xl:block">
      <div className="container mx-auto flex h-9 max-w-[1280px] items-center gap-1 px-[32px]">
        {links.map((link) => {
          const content = (
            <>
              <ServiceIcon link={link} />
              {link.label}
              {link.isNew && (
                <span className="bg-pink text-ink h-3.5 rounded-full px-1 text-[9px] leading-[14px] font-bold">
                  {t("serviceBar.new")}
                </span>
              )}
            </>
          )

          if (link.external) {
            return (
              <a
                key={link.key}
                href={link.href}
                target="_blank"
                rel="noreferrer"
                className={ITEM_CLASS_NAME}
              >
                {content}
              </a>
            )
          }

          return (
            <LocalizedClientLink
              key={link.key}
              href={link.href}
              className={ITEM_CLASS_NAME}
            >
              {content}
            </LocalizedClientLink>
          )
        })}

        <div className="text-muted-foreground ml-auto flex items-center gap-3">
          <UserInfo />

          <LocalizedClientLink
            href="/cs"
            className="hover:text-foreground transition-colors"
          >
            {t("utility.support")}
          </LocalizedClientLink>

          <LanguageSwitcher />
        </div>
      </div>
    </div>
  )
}

function ServiceIcon({ link }: { link: ServiceLink }) {
  return (
    <span
      className={cn(
        "relative grid h-5 shrink-0 place-items-center overflow-hidden rounded-md",
        link.wide ? "w-12 bg-[#4f4a44]" : "w-5",
        !link.wide && (link.imageUrl ? "bg-white" : "bg-ink")
      )}
    >
      {link.imageUrl ? (
        <Image
          src={link.imageUrl}
          alt=""
          fill
          sizes={link.wide ? "48px" : "20px"}
          className={link.wide ? "object-contain px-1" : "object-cover"}
        />
      ) : (
        <ChartNoAxesColumn aria-hidden className="h-3 w-3 text-white" />
      )}
    </span>
  )
}
