import { ProductTemplate } from "@/domains/products/product-details/templates"
import { retrieveCustomer } from "@/lib/api/medusa/customer"
import { listProducts } from "@lib/api/medusa/products"
import { getRegion } from "@lib/api/medusa/regions"
import { Metadata } from "next"
import { notFound } from "next/navigation"

type Props = {
  params: Promise<{ countryCode: string; handle: string }>
  searchParams: Promise<{ v_id?: string }>
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params
  const { handle } = params
  const region = await getRegion(params.countryCode)

  if (!region) {
    notFound()
  }

  const product = await listProducts({
    countryCode: params.countryCode,
    queryParams: { handle },
  }).then(({ response }) => response.products[0])

  if (!product) {
    notFound()
  }

  return {
    title: `${product.title}`,
    description: `${product.title}`,
    openGraph: {
      title: `${product.title}`,
      description: `${product.title}`,
      images: product.thumbnail ? [product.thumbnail] : [],
    },
  }
}

export default async function Page(props: Props) {
  const params = await props.params
  const region = await getRegion(params.countryCode)
  // const searchParams = await props.searchParams // 추후 사용자가 새로고침했을때 선택했던 variant를 유지하기위해 사용

  if (!region) {
    notFound()
  }

  const pricedProduct = await listProducts({
    countryCode: params.countryCode,
    queryParams: { handle: params.handle },
  }).then(({ response }) => response.products[0])

  if (!pricedProduct) {
    notFound()
  }

  const customer = await retrieveCustomer()

  return (
    <div className="md:bg-muted/50 min-h-screen bg-white">
      <ProductTemplate
        product={pricedProduct}
        region={region}
        countryCode={params.countryCode}
      />
    </div>
  )
}
