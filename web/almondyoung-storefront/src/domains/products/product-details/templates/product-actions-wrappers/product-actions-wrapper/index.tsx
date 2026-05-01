import { listProducts } from "@/lib/api/medusa/products"
import { Customer } from "@/lib/types/ui/medusa"
import { HttpTypes } from "@medusajs/types"
import ProductActions from "../../../components/product-actions"

export default async function ProductActionsWrapper({
  id,
  region,
  customer,
}: {
  id: string
  region: HttpTypes.StoreRegion
  customer: Customer | null
}) {
  const product = await listProducts({
    queryParams: { id: [id] },
    regionId: region.id,
  }).then(({ response }) => response.products[0])

  if (!product) {
    return null
  }

  return (
    <ProductActions product={product} region={region} customer={customer} />
  )
}
