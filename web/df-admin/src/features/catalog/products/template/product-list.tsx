import { useNavigate } from "react-router-dom"
import { Plus } from "lucide-react"
import { Container } from "@/components/common/container"
import { PageHeader } from "@/components/common/page-header"
import { Button } from "@/components/ui/button"
import { useCreateProduct } from "@/lib/services/catalog/products"
import { ProductTable } from "../components/product-table"
import { toast } from "sonner"

export default function ProductListTemplate() {
  const navigate = useNavigate()
  const createProduct = useCreateProduct()

  const handleCreate = async () => {
    try {
      const product = await createProduct.mutateAsync()
      toast.success("새 상품이 생성되었습니다")
      navigate(`/catalog/products/${product.masterId}`)
    } catch {
      toast.error("상품 생성 실패")
    }
  }

  return (
    <Container>
      <PageHeader
        title="상품 관리"
        subtitle="판매 상품을 관리합니다"
        actions={
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={createProduct.isPending}
          >
            <Plus className="mr-1 h-4 w-4" />
            상품 추가
          </Button>
        }
      />
      <ProductTable />
    </Container>
  )
}
