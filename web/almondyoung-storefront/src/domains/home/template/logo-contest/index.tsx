import LocalizedClientLink from "@/components/shared/localized-client-link"
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel"
import { EntryCard } from "@/domains/logo-contest/components/entry-card"
import {
  getLogoContestStatus,
  getMyLogoContestState,
  listTopLogoContestEntries,
} from "@/lib/api/ugc/logo-contest"
import { ArrowRight } from "lucide-react"
import { getTranslations } from "next-intl/server"
import { Title } from "../../components/header"
import { HomeSection } from "../../components/shared/home-section"

export async function LogoContestWrapper({
  countryCode,
}: {
  countryCode: string
}) {
  const [status, t] = await Promise.all([
    getLogoContestStatus().catch(() => null),
    getTranslations("logoContest"),
  ])

  if (!status?.isOpen) return null

  const [entries, myState] = await Promise.all([
    listTopLogoContestEntries().catch(() => []),
    getMyLogoContestState().catch(() => null),
  ])
  if (entries.length === 0) return null

  return (
    <HomeSection background="muted" className="border-t-0">
      <Carousel opts={{ align: "start" }} className="group/carousel w-full">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <Title>{t("title")}</Title>
            <p className="text-muted-foreground mt-1 text-sm">
              {t("homeDescription")}
            </p>
          </div>
          <LocalizedClientLink
            href="/logo-contest"
            className="text-primary inline-flex items-center gap-1 text-sm font-semibold"
          >
            {t("join")} <ArrowRight className="h-4 w-4" />
          </LocalizedClientLink>
        </div>
        <CarouselContent className="-ml-2 py-2 sm:-ml-4">
          {entries.map((entry) => (
            <CarouselItem
              key={entry.id}
              className="basis-[82%] pl-2 md:basis-[48%] md:pl-4 lg:basis-[25%]"
            >
              <EntryCard
                entry={entry}
                countryCode={countryCode}
                canVote
                isClosed={false}
                isOwnEntry={myState?.entry?.id === entry.id}
                votedEntryId={myState?.votedEntryId ?? null}
                enableSwipe={false}
              />
            </CarouselItem>
          ))}
        </CarouselContent>
        <CarouselPrevious className="left-2 hidden size-10 bg-white/90 opacity-0 shadow-md transition-opacity group-hover/carousel:opacity-100 disabled:opacity-0 md:inline-flex" />
        <CarouselNext className="right-2 hidden size-10 bg-white/90 opacity-0 shadow-md transition-opacity group-hover/carousel:opacity-100 disabled:opacity-0 md:inline-flex" />
      </Carousel>
    </HomeSection>
  )
}
