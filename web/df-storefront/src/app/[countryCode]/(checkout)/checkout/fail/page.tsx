import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { Button, Heading, Text } from "@medusajs/ui"

export default async function CheckoutFailPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; message?: string }>
}) {
  const { code, message } = await searchParams

  return (
    <div className="content-container py-12">
      <div className="mx-auto flex max-w-2xl flex-col gap-y-6 rounded-rounded bg-white p-8">
        <Heading level="h1" className="text-3xl-regular">
          Payment could not be completed
        </Heading>
        <Text className="txt-medium text-ui-fg-subtle">
          {message || "Please try the checkout again."}
        </Text>
        {code && (
          <Text className="txt-small text-ui-fg-muted">Error code: {code}</Text>
        )}
        <div className="flex gap-4">
          <LocalizedClientLink href="/checkout?step=payment">
            <Button>Try again</Button>
          </LocalizedClientLink>
          <LocalizedClientLink href="/cart">
            <Button variant="secondary">Back to cart</Button>
          </LocalizedClientLink>
        </div>
      </div>
    </div>
  )
}
