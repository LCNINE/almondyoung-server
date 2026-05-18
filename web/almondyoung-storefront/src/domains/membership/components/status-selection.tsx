"use client"

import { useTranslations } from "next-intl"
import Image from "next/image"
import React from "react"

export default function MembershipStatusSection({
  children,
}: {
  children: React.ReactNode
}) {
  const t = useTranslations("mypage.membership")
  return (
    <section className="flex flex-col items-center gap-8 self-stretch rounded-xl border-gray-200 py-10 md:border md:px-6">
      <header className="flex flex-col items-center gap-3 text-center">
        <figure className="flex flex-col items-center gap-2">
          <Image
            src="/icons/membership-logo.svg"
            alt={t("logoAlt")}
            width={64}
            height={64}
          />
        </figure>
      </header>
      {children}
    </section>
  )
}
