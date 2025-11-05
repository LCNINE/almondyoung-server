import { HelpCircle } from "lucide-react"
import type { ProductDetail } from "@lib/types/ui/product"

type Props = {
  shipping: NonNullable<ProductDetail["shipping"]>
}

/**
 * @description 배송 정보 컴포넌트
 * - shipping이 있다면 모든 필드가 있다고 가정
 * - 조건부 렌더링은 이 컴포넌트를 사용하는 곳에서 처리
 * 시맨틱: <dl> 태그를 사용하여 정의 목록 표현
 */
export function ProductShippingInfo({ shipping }: Props) {
  return (
    <section className="my-4 border-y py-4 md:border-t md:border-b-0 md:pt-4">
      <dl className="space-y-2 text-sm">
        <InfoRow
          label="국내 / 해외배송"
          value={shipping.type === "international" ? "해외배송" : "국내배송"}
        />
        <InfoRow label="배송방법" value={shipping.method || "택배"} />
        <InfoRow
          label="배송비"
          value={`${shipping.cost || "무료"} ${shipping.shipmentInfo || ""}`}
        />
        <div className="flex">
          <dt className="w-32 text-gray-600 md:w-28">평균 재입고 소요일</dt>
          <dd className="flex items-center">
            {shipping.averageRestockDays || 0}일
            <HelpCircle
              className="ml-1 h-3 w-3 text-gray-400"
              aria-label="재입고 소요일 안내"
            />
          </dd>
        </div>
      </dl>
    </section>
  )
}

// 정보 행 컴포넌트
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex">
      <dt className="w-32 text-gray-600 md:w-28">{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}
