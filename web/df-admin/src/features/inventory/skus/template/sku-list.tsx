import { useState } from "react"
import { Plus } from "lucide-react"
import { Container } from "@/components/common/container"
import { PageHeader } from "@/components/common/page-header"
import { Button } from "@/components/ui/button"
import { SkuTable } from "../components/sku-table"
import { SkuFormDialog } from "../components/sku-form-dialog"

export default function SkuListTemplate() {
  const [createOpen, setCreateOpen] = useState(false)

  return (
    <>
      <Container>
        <PageHeader
          title="재고상품 관리"
          subtitle="SKU(재고상품)을 관리합니다"
          actions={
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1 h-4 w-4" />
              SKU 추가
            </Button>
          }
        />
        <SkuTable />
      </Container>
      <SkuFormDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  )
}
