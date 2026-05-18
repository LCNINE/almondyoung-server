import { getTranslations } from "next-intl/server"
import { Card, CardContent } from "@components/common/ui/card"
import { Price } from "@components/price"

export default async function PointSection({
  withdrawable,
}: {
  withdrawable: number
}) {
  const t = await getTranslations("mypage.payment")
  return (
    <Card className="mb-4 border-none shadow-xs">
      <CardContent className="flex items-center justify-between p-7">
        <div>
          <span className="text-foreground font-bold sm:text-lg">
            {t("pointTitle")}
          </span>
        </div>

        <div>
          <Price
            amount={withdrawable}
            className="text-foreground mr-2 text-base font-bold sm:text-lg"
            unitClassName="text-muted-foreground text-sm sm:text-base"
          />
        </div>
      </CardContent>
    </Card>
  )
}
