import { CardSkeleton } from "@/domains/beautytop/components/parts"

export default function Loading() {
  return (
    <div className="bg-secondary">
      <div className="mx-auto flex max-w-[640px] flex-col gap-6 px-4 pt-6 pb-10">
        <CardSkeleton />
        <CardSkeleton variant="list" />
        <CardSkeleton variant="chart" />
      </div>
    </div>
  )
}
