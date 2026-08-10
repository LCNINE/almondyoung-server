import * as React from "react"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

type SiteBreadcrumbItem = {
  label: React.ReactNode
  href?: string
}

export function SiteBreadcrumb({
  items,
  className,
}: {
  items: SiteBreadcrumbItem[]
  className?: string
}) {
  return (
    <Breadcrumb className={className}>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <LocalizedClientLink href="/">홈</LocalizedClientLink>
          </BreadcrumbLink>
        </BreadcrumbItem>

        {items.map((item, index) => {
          const isLast = index === items.length - 1

          return (
            <React.Fragment key={index}>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                {item.href && !isLast ? (
                  <BreadcrumbLink asChild>
                    <LocalizedClientLink href={item.href}>
                      {item.label}
                    </LocalizedClientLink>
                  </BreadcrumbLink>
                ) : (
                  <BreadcrumbPage className="line-clamp-1 max-w-[220px] sm:max-w-[360px] xl:max-w-[480px]">
                    {item.label}
                  </BreadcrumbPage>
                )}
              </BreadcrumbItem>
            </React.Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
