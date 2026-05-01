import { TableCell, TableRow } from "@/components/ui/table"

const SkeletonLineItem = () => {
  return (
    <TableRow className="w-full">
      {/* 썸네일 */}
      <TableCell className="w-24 p-4 pl-0">
        <div className="h-12 w-12 animate-pulse rounded-md bg-gray-200 sm:h-24 sm:w-24" />
      </TableCell>

      {/* 상품명 & 옵션 */}
      <TableCell className="text-left">
        <div className="flex flex-col gap-y-2">
          <div className="h-4 w-32 animate-pulse rounded bg-gray-200" />
          <div className="h-3 w-20 animate-pulse rounded bg-gray-200" />
        </div>
      </TableCell>

      {/* 수량 */}
      <TableCell>
        <div className="flex w-28 items-center gap-2">
          <div className="h-8 w-8 animate-pulse rounded bg-gray-200" />
          <div className="h-10 w-14 animate-pulse rounded bg-gray-200" />
        </div>
      </TableCell>

      {/* 단가 */}
      <TableCell className="hidden sm:table-cell">
        <div className="h-4 w-16 animate-pulse rounded bg-gray-200" />
      </TableCell>

      {/* 합계 */}
      <TableCell className="pr-0 text-right">
        <div className="flex flex-col items-end">
          <div className="h-4 w-20 animate-pulse rounded bg-gray-200" />
        </div>
      </TableCell>
    </TableRow>
  )
}

export default SkeletonLineItem
