import { Container } from "@/components/common/container"
import { PageHeader } from "@/components/common/page-header"
import { ProductDraftsTable } from "../components/product-drafts-table"

export default function ProductDraftsTemplate() {
  return (
    <Container>
      <PageHeader
        title="작성중 상품"
        subtitle="발행되지 않은 Draft 버전 목록"
      />
      <ProductDraftsTable />
    </Container>
  )
}
