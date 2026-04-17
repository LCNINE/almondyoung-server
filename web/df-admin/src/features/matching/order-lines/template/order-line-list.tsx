import { Container } from "@/components/common/container"
import { PageHeader } from "@/components/common/page-header"
import { OrderLineTable } from "../components/order-line-table"

export default function OrderLineListTemplate() {
  return (
    <Container>
      <PageHeader
        title="주문 매칭 관리"
        subtitle="주문 라인별 SKU 매칭 상태를 조회하고 처리합니다"
      />
      <OrderLineTable />
    </Container>
  )
}
