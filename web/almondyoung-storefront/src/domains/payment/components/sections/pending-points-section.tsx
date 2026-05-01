import { Card, CardContent } from "@components/common/ui/card"
import { Price } from "@components/price"

// 적립 예정인 적립금 섹션
export default function PendingPointsSection({
  pendingPoints,
}: {
  pendingPoints: number
}) {
  return (
    <Card className="my-4 border-none shadow-xs">
      <CardContent className="flex items-center justify-between p-7">
        <div>
          <span className="text-foreground font-bold sm:text-lg">
            곧 적립될 아몬드영 적립금이에요
          </span>
        </div>

        <div>
          <Price
            amount={pendingPoints}
            className="text-foreground mr-2 text-base font-bold sm:text-lg"
            unitClassName="text-muted-foreground text-sm sm:text-base"
          />
        </div>
      </CardContent>
    </Card>
  )
}
