import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

const repeat = (count: number) => Array.from({ length: count })

function SectionTitleSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-4 w-64" />
    </div>
  )
}

function ProductCardSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="aspect-[3/4] w-full" />
      <Skeleton className="h-4 w-4/5" />
      <Skeleton className="h-4 w-2/5" />
      <Skeleton className="h-3 w-1/3" />
    </div>
  )
}

function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-6">
      {repeat(count).map((_, index) => (
        <ProductCardSkeleton key={`product-skeleton-${index}`} />
      ))}
    </div>
  )
}

function ListRowSkeleton() {
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-4 md:flex-row md:items-center">
      <Skeleton className="h-16 w-16 rounded-md" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-3 w-2/5" />
      </div>
      <Skeleton className="h-8 w-24" />
    </div>
  )
}

function FormFieldSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-10 w-full" />
    </div>
  )
}

export function GenericPageSkeleton() {
  return (
    <div className="min-h-screen bg-white">
      <div className="container mx-auto max-w-[1200px] px-4 py-10 md:px-[40px]">
        <SectionTitleSkeleton />
        <div className="mt-8 space-y-4">
          {repeat(6).map((_, index) => (
            <Skeleton key={`generic-line-${index}`} className="h-4 w-full" />
          ))}
        </div>
      </div>
    </div>
  )
}

export function HomePageSkeleton() {
  return (
    <div className="min-h-screen bg-white">
      <div className="w-full">
        <div className="px-4 pb-4 pt-4 md:pb-[87px]">
          <Skeleton className="h-[350px] w-full rounded-2xl md:h-[540px]" />
        </div>
        <section className="w-full border-t border-gray-200 py-8 lg:py-12">
          <div className="container mx-auto max-w-[1360px] px-4 md:px-[40px]">
            <CategoryBestSectionSkeleton />
          </div>
        </section>
      </div>
    </div>
  )
}

export function CategoryListSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>

      <div className="flex gap-2 overflow-hidden">
        {repeat(5).map((_, index) => (
          <Skeleton key={`tab-${index}`} className="h-10 w-24 rounded-full" />
        ))}
      </div>

      <Skeleton className="h-28 w-full rounded-2xl" />

      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-4 w-32" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-24 rounded-md" />
          <Skeleton className="h-9 w-24 rounded-md" />
        </div>
      </div>

      <ProductGridSkeleton count={12} />
    </div>
  )
}

export function CategorySubSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>

      <div className="flex gap-2 overflow-hidden">
        {repeat(6).map((_, index) => (
          <Skeleton key={`sub-tab-${index}`} className="h-9 w-24 rounded-full" />
        ))}
      </div>

      <div className="flex items-center justify-end gap-3 md:hidden">
        <Skeleton className="h-9 w-24 rounded-md" />
        <Skeleton className="h-9 w-20 rounded-md" />
      </div>

      <div className="hidden md:block">
        <Skeleton className="h-10 w-full rounded-md" />
      </div>

      <ProductGridSkeleton count={12} />
    </div>
  )
}

export function ClassPageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-72" />
      </div>

      <div className="flex gap-3 overflow-hidden">
        {repeat(6).map((_, index) => (
          <Skeleton key={`class-tab-${index}`} className="h-14 w-24 rounded-full" />
        ))}
      </div>

      <Skeleton className="h-28 w-full rounded-2xl" />

      <div className="space-y-3">
        <Skeleton className="h-5 w-28" />
        <div className="flex gap-3 overflow-hidden">
          {repeat(4).map((_, index) => (
            <Skeleton key={`class-slide-${index}`} className="h-40 w-40 rounded-xl" />
          ))}
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 md:hidden">
        <Skeleton className="h-9 w-24 rounded-md" />
        <Skeleton className="h-9 w-20 rounded-md" />
      </div>

      <div className="hidden md:block">
        <Skeleton className="h-10 w-full rounded-md" />
      </div>
    </div>
  )
}

export function CategoryBestSectionSkeleton() {
  return (
    <div className="w-full">
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-16" />
      </div>
      <div className="mt-4 flex gap-2 overflow-hidden">
        {repeat(6).map((_, index) => (
          <Skeleton key={`best-tab-${index}`} className="h-9 w-24 rounded-full" />
        ))}
      </div>
      <div className="mt-6">
        <ProductGridSkeleton count={10} />
      </div>
    </div>
  )
}

export function SearchPageSkeleton() {
  return (
    <main className="min-h-screen bg-white">
      <div className="container mx-auto max-w-[1360px] px-4 py-6 md:px-[40px]">
        <section className="space-y-6">
          <div className="space-y-3">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-56" />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="hidden h-4 w-24 md:block" />
            <Skeleton className="h-9 w-32 rounded-md" />
          </div>
          <ProductGridSkeleton count={12} />
          <div className="flex justify-center gap-2">
            {repeat(5).map((_, index) => (
              <Skeleton key={`page-${index}`} className="h-9 w-9 rounded-md" />
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}

export function BestPageSkeleton() {
  return (
    <div className="min-h-screen bg-white">
      <main className="container mx-auto max-w-[1100px] px-4 py-6 md:px-[40px]">
        <section className="rounded-lg border-t border-gray-200 bg-white py-8">
          <SectionTitleSkeleton />
          <div className="mt-6">
            <ProductGridSkeleton count={8} />
          </div>
        </section>

        <section className="my-8 rounded-lg bg-white">
          <SectionTitleSkeleton />
          <div className="mt-6 space-y-4">
            {repeat(6).map((_, index) => (
              <Skeleton key={`best-brand-${index}`} className="h-4 w-1/2" />
            ))}
          </div>
        </section>

        <section className="my-8 rounded-lg bg-white">
          <SectionTitleSkeleton />
          <div className="mt-6 space-y-4">
            {repeat(6).map((_, index) => (
              <Skeleton key={`best-keyword-${index}`} className="h-4 w-1/2" />
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}

export function NewPageSkeleton() {
  return (
    <div className="min-h-screen bg-white">
      <main className="container mx-auto max-w-[1360px] px-[40px] py-8">
        <Skeleton className="mb-4 h-7 w-24" />
        <Skeleton className="mb-3 h-4 w-56" />
        <Skeleton className="h-4 w-64" />
      </main>
    </div>
  )
}

export function ProductDetailSkeleton() {
  return (
    <div className="md:bg-muted/50 min-h-screen bg-white">
      <div className="mx-auto max-w-[1360px] px-[15px] md:px-[40px]">
        <div className="py-2 md:flex md:gap-4">
          <main className="w-full min-w-0 flex-1 pb-24 md:pb-0 space-y-6">
            <div className="space-y-4">
              <Skeleton className="aspect-square w-full rounded-2xl" />
              <div className="grid grid-cols-4 gap-3">
                {repeat(4).map((_, index) => (
                  <Skeleton key={`thumb-${index}`} className="aspect-square w-full rounded-lg" />
                ))}
              </div>
            </div>

            <div className="space-y-3 md:hidden">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-5 w-1/2" />
            </div>

            <div className="flex gap-2 border-b pb-3">
              {repeat(4).map((_, index) => (
                <Skeleton key={`tab-${index}`} className="h-9 w-20 rounded-full" />
              ))}
            </div>

            <div className="space-y-3">
              {repeat(6).map((_, index) => (
                <Skeleton key={`detail-${index}`} className="h-4 w-full" />
              ))}
              <Skeleton className="h-40 w-full rounded-lg" />
            </div>

            <div className="rounded-lg bg-white px-4 py-6 md:px-6 space-y-4">
              <Skeleton className="h-5 w-32" />
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                {repeat(4).map((_, index) => (
                  <Skeleton key={`review-${index}`} className="h-24 w-full rounded-lg" />
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <Skeleton className="h-5 w-32" />
              {repeat(3).map((_, index) => (
                <Skeleton key={`accordion-${index}`} className="h-12 w-full rounded-lg" />
              ))}
            </div>
          </main>

          <aside className="hidden md:block w-[360px] shrink-0 space-y-4">
            <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-4">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-4 w-24" />
              {repeat(3).map((_, index) => (
                <Skeleton key={`side-option-${index}`} className="h-10 w-full" />
              ))}
              <div className="flex gap-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}

export function CartPageSkeleton() {
  return (
    <div className="min-h-screen bg-muted">
      <div className="container mx-auto py-0 md:py-8 md:max-w-[1360px] md:px-[40px]">
        {/* Mobile */}
        <div className="md:hidden">
          <div className="bg-white">
            <div className="flex gap-2 px-4 py-3">
              {repeat(3).map((_, index) => (
                <Skeleton
                  key={`cart-tab-${index}`}
                  className="h-8 w-20 rounded-full"
                />
              ))}
            </div>
          </div>

          <div className="bg-white p-4 space-y-4">
            <Skeleton className="h-10 w-full rounded-lg" />
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-16" />
            </div>
            <div className="space-y-4">
              {repeat(3).map((_, index) => (
                <div
                  key={`cart-mobile-item-${index}`}
                  className="flex gap-4 rounded-lg border border-gray-200 bg-white p-4"
                >
                  <Skeleton className="h-20 w-20 rounded-md" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Desktop */}
        <div className="hidden md:block">
          <div className="flex items-center justify-between py-8">
            <Skeleton className="h-10 w-32" />
            <div className="flex items-center gap-3">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-5 w-5 rounded-full" />
              <Skeleton className="h-5 w-12" />
            </div>
          </div>

          <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
            <div className="space-y-4">
              {repeat(3).map((_, index) => (
                <ListRowSkeleton key={`cart-item-${index}`} />
              ))}
            </div>
            <aside className="space-y-4 rounded-lg border border-gray-200 bg-white p-6">
              <Skeleton className="h-6 w-32" />
              {repeat(4).map((_, index) => (
                <Skeleton key={`cart-summary-${index}`} className="h-4 w-full" />
              ))}
              <Skeleton className="h-12 w-full" />
            </aside>
          </div>

          <div className="mt-10 space-y-4">
            <Skeleton className="h-6 w-40" />
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {repeat(4).map((_, index) => (
                <ProductCardSkeleton key={`cart-reco-${index}`} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function CheckoutPageSkeleton() {
  return (
    <div className="min-h-screen bg-muted">
      <div className="hidden lg:block border-b bg-white">
        <div className="container mx-auto max-w-[1360px] px-4 py-6 lg:px-[40px]">
          <Skeleton className="h-6 w-40" />
        </div>
      </div>

      <div className="container mx-auto max-w-[1360px] px-4 lg:px-[40px] lg:py-8">
        <div className="lg:hidden mb-4">
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>

        <div className="lg:flex lg:w-full lg:justify-between lg:gap-9">
          <div className="lg:max-w-[820px] lg:min-w-[420px] lg:flex-1 space-y-6">
            <div className="rounded-[10px] border border-gray-200 bg-white p-6 space-y-4">
              <Skeleton className="h-6 w-32" />
              <FormFieldSkeleton />
              <FormFieldSkeleton />
            </div>

            <div className="rounded-[10px] border border-gray-200 bg-white p-6 space-y-4">
              <Skeleton className="h-6 w-32" />
              {repeat(3).map((_, index) => (
                <Skeleton key={`shipping-${index}`} className="h-12 w-full" />
              ))}
            </div>

            <div className="rounded-[10px] border border-gray-200 bg-white p-6 space-y-4">
              <Skeleton className="h-6 w-32" />
              {repeat(3).map((_, index) => (
                <Skeleton key={`order-item-${index}`} className="h-20 w-full" />
              ))}
            </div>

            <div className="rounded-[10px] border border-gray-200 bg-white p-6 space-y-4">
              <Skeleton className="h-6 w-32" />
              {repeat(2).map((_, index) => (
                <Skeleton key={`discount-${index}`} className="h-12 w-full" />
              ))}
            </div>

            <div className="rounded-[10px] border border-gray-200 bg-white p-6 space-y-4">
              <Skeleton className="h-6 w-32" />
              {repeat(3).map((_, index) => (
                <Skeleton key={`payment-method-${index}`} className="h-12 w-full" />
              ))}
            </div>
          </div>

          <div className="lg:shrink-0 mt-8 lg:mt-0 space-y-4">
            <div className="rounded-[10px] border border-gray-200 bg-white p-6 space-y-3">
              <Skeleton className="h-5 w-32" />
              {repeat(5).map((_, index) => (
                <Skeleton key={`summary-${index}`} className="h-4 w-full" />
              ))}
              <Skeleton className="h-12 w-full" />
            </div>
            <div className="rounded-[10px] border border-gray-200 bg-white p-6 space-y-3">
              <Skeleton className="h-5 w-32" />
              {repeat(4).map((_, index) => (
                <Skeleton key={`detail-${index}`} className="h-4 w-full" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function MembershipCheckoutSkeleton() {
  return (
    <div className="min-h-screen bg-muted">
      <div className="hidden lg:block border-b bg-white">
        <div className="container mx-auto max-w-[1360px] px-4 py-6 lg:px-[40px]">
          <Skeleton className="h-6 w-40" />
        </div>
      </div>

      <div className="container mx-auto max-w-[1360px] px-4 lg:px-[40px] lg:py-8">
        <div className="lg:hidden mb-4">
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>

        <div className="lg:flex lg:w-full lg:justify-between lg:gap-9">
          <div className="lg:max-w-[820px] lg:min-w-[420px] lg:flex-1 space-y-6">
            <div className="rounded-[10px] border border-gray-200 bg-white p-6 space-y-4">
              <Skeleton className="h-6 w-32" />
              <div className="flex items-center justify-between">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-5 w-32" />
                </div>
                <Skeleton className="h-6 w-20" />
              </div>
            </div>

            <div className="rounded-[10px] border border-gray-200 bg-white p-6 space-y-4">
              <Skeleton className="h-6 w-32" />
              {repeat(3).map((_, index) => (
                <Skeleton key={`membership-total-${index}`} className="h-4 w-full" />
              ))}
            </div>

            <div className="rounded-[10px] border border-gray-200 bg-white p-6 space-y-4">
              <Skeleton className="h-6 w-32" />
              {repeat(3).map((_, index) => (
                <Skeleton key={`membership-method-${index}`} className="h-12 w-full" />
              ))}
            </div>
          </div>

          <div className="lg:shrink-0 mt-8 lg:mt-0 space-y-4">
            <div className="rounded-[10px] border border-gray-200 bg-white p-6 space-y-3">
              <Skeleton className="h-5 w-32" />
              {repeat(4).map((_, index) => (
                <Skeleton key={`membership-summary-${index}`} className="h-4 w-full" />
              ))}
              <Skeleton className="h-12 w-full" />
            </div>
            <div className="rounded-[10px] border border-gray-200 bg-white p-6 space-y-3">
              <Skeleton className="h-5 w-32" />
              {repeat(3).map((_, index) => (
                <Skeleton key={`membership-detail-${index}`} className="h-4 w-full" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function ResultPageSkeleton() {
  return (
    <div className="min-h-screen bg-white">
      <div className="container mx-auto max-w-[720px] px-4 py-16">
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center">
          <Skeleton className="mx-auto h-16 w-16 rounded-full" />
          <Skeleton className="mx-auto mt-6 h-6 w-40" />
          <Skeleton className="mx-auto mt-3 h-4 w-56" />
          <Skeleton className="mx-auto mt-8 h-12 w-40" />
        </div>
      </div>
    </div>
  )
}

export function ProcessingPageSkeleton() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f8f8f8]">
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-lg">
        <div className="flex flex-col items-center">
          <Skeleton className="mb-4 h-16 w-16 rounded-full" />
          <Skeleton className="mb-2 h-6 w-32" />
          <Skeleton className="h-4 w-40" />
          <div className="mt-6 space-y-2 text-center">
            <Skeleton className="h-3 w-48" />
            <Skeleton className="h-3 w-36" />
          </div>
        </div>
      </div>
    </div>
  )
}

export function AuthFormSkeleton() {
  return (
    <div className="min-h-screen bg-white">
      <div className="container mx-auto max-w-[480px] px-4 py-12">
        <Skeleton className="mx-auto h-8 w-32" />
        <div className="mt-10 space-y-4">
          {repeat(4).map((_, index) => (
            <FormFieldSkeleton key={`auth-field-${index}`} />
          ))}
        </div>
        <Skeleton className="mt-8 h-12 w-full" />
      </div>
    </div>
  )
}

export function AuthCallbackSkeleton() {
  return (
    <div className="min-h-screen bg-white">
      <div className="container mx-auto max-w-[520px] px-4 py-16">
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center">
          <Skeleton className="mx-auto h-12 w-12 rounded-full" />
          <Skeleton className="mx-auto mt-6 h-5 w-40" />
          <Skeleton className="mx-auto mt-3 h-4 w-56" />
        </div>
      </div>
    </div>
  )
}

export function AuthLoginSkeleton() {
  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto flex min-h-lvh w-full max-w-[320px] flex-col justify-center px-4">
        <Skeleton className="mx-auto h-7 w-56" />
        <div className="mt-12 space-y-4">
          <FormFieldSkeleton />
          <FormFieldSkeleton />
        </div>
        <Skeleton className="mt-6 h-12 w-full" />
        <div className="mt-6 flex items-center justify-between gap-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-16" />
        </div>
      </div>
    </div>
  )
}

export function AuthFindIdSkeleton() {
  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto flex min-h-lvh w-full max-w-[375px] flex-col justify-center px-4">
        <div className="mb-6 text-center space-y-2">
          <Skeleton className="mx-auto h-7 w-32" />
          <Skeleton className="mx-auto h-4 w-64" />
        </div>
        <div className="space-y-4">
          <FormFieldSkeleton />
          <Skeleton className="h-10 w-full" />
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-20" />
            </div>
            <div className="flex items-center justify-between">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-12" />
            </div>
          </div>
          <Skeleton className="h-12 w-full" />
        </div>
      </div>
    </div>
  )
}

export function AuthFindPasswordSkeleton() {
  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto flex min-h-lvh w-full max-w-[375px] flex-col justify-center px-4">
        <div className="mb-6 text-center space-y-2">
          <Skeleton className="mx-auto h-7 w-36" />
          <Skeleton className="mx-auto h-4 w-72" />
        </div>
        <div className="space-y-4">
          <FormFieldSkeleton />
          <Skeleton className="h-10 w-full" />
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-20" />
            </div>
            <Skeleton className="h-3 w-28" />
          </div>
          <FormFieldSkeleton />
          <div className="space-y-3">
            <FormFieldSkeleton />
            <FormFieldSkeleton />
          </div>
          <Skeleton className="h-12 w-full" />
        </div>
      </div>
    </div>
  )
}

export function AuthSignupSkeleton() {
  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto flex w-full max-w-[500px] flex-col gap-6 px-4 py-6 md:py-0">
        <div className="space-y-2">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-56" />
        </div>
        <div className="space-y-6">
          <div className="space-y-3">
            <Skeleton className="h-4 w-20" />
            {repeat(2).map((_, index) => (
              <FormFieldSkeleton key={`signup-account-${index}`} />
            ))}
          </div>
          <div className="space-y-3">
            <Skeleton className="h-4 w-20" />
            {repeat(3).map((_, index) => (
              <FormFieldSkeleton key={`signup-personal-${index}`} />
            ))}
          </div>
          <div className="space-y-3">
            <Skeleton className="h-4 w-20" />
            <FormFieldSkeleton />
            <div className="flex items-center gap-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-20" />
            </div>
          </div>
          <div className="space-y-3">
            <Skeleton className="h-4 w-24" />
            {repeat(2).map((_, index) => (
              <FormFieldSkeleton key={`signup-password-${index}`} />
            ))}
          </div>
          <div className="space-y-3">
            <Skeleton className="h-4 w-24" />
            {repeat(5).map((_, index) => (
              <div key={`signup-consent-${index}`} className="flex items-center gap-3">
                <Skeleton className="h-4 w-4 rounded-sm" />
                <Skeleton className="h-4 w-48" />
              </div>
            ))}
          </div>
          <Skeleton className="h-12 w-full" />
        </div>
      </div>
    </div>
  )
}

export function ConsentsSkeleton() {
  return (
    <div className="min-h-screen bg-white">
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
        <div className="w-full max-w-2xl space-y-6 rounded-lg bg-white p-6 shadow-sm md:p-8">
          <div className="space-y-2">
            <Skeleton className="h-7 w-56" />
            <Skeleton className="h-4 w-72" />
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-lg border-2 border-gray-200 p-4">
              <Skeleton className="h-5 w-5 rounded-sm" />
              <Skeleton className="h-5 w-40" />
            </div>
            <div className="space-y-3">
              {repeat(5).map((_, index) => (
                <div
                  key={`consent-${index}`}
                  className="flex items-center gap-3 rounded-lg border border-gray-200 p-4"
                >
                  <Skeleton className="h-5 w-5 rounded-sm" />
                  <Skeleton className="h-4 w-64" />
                  <Skeleton className="h-3 w-16" />
                </div>
              ))}
            </div>
          </div>

          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-3 w-64 mx-auto" />
        </div>
      </div>
    </div>
  )
}

export function PolicyPageSkeleton() {
  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-3xl px-4 py-12">
        <Skeleton className="mb-8 h-7 w-48" />
        {repeat(2).map((_, sectionIndex) => (
          <section key={`policy-section-${sectionIndex}`} className="mb-12">
            <Skeleton className="mb-4 h-5 w-40" />
            <div className="space-y-3">
              {repeat(6).map((__, lineIndex) => (
                <Skeleton
                  key={`policy-line-${sectionIndex}-${lineIndex}`}
                  className="h-4 w-full"
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

export function SitemapSkeleton() {
  return (
    <div className="min-h-screen bg-white">
      <div className="container mx-auto max-w-[1000px] px-4 py-12">
        <SectionTitleSkeleton />
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {repeat(6).map((_, index) => (
            <div key={`sitemap-${index}`} className="space-y-3">
              <Skeleton className="h-5 w-32" />
              {repeat(4).map((__, itemIndex) => (
                <Skeleton
                  key={`sitemap-item-${index}-${itemIndex}`}
                  className="h-4 w-40"
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function MypageHomeSkeleton() {
  return (
    <div className="bg-white">
      <div className="block lg:hidden">
        <div className="container mx-auto px-4 py-6">
          <Skeleton className="h-20 w-full rounded-xl" />
          <div className="mt-6 space-y-4">
            {repeat(4).map((_, index) => (
              <Skeleton key={`mypage-mobile-${index}`} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        </div>
      </div>
      <div className="hidden lg:block">
        <main className="md:bg-muted w-full bg-white">
          <div className="container mx-auto max-w-[1360px]">
            <div className="inner md:px-[40px] md:py-10">
              <Skeleton className="mb-6 h-4 w-32" />
              <div className="flex flex-row gap-8">
                <aside className="hidden w-[280px] shrink-0 lg:block">
                  <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-6">
                    {repeat(6).map((_, index) => (
                      <Skeleton key={`mypage-side-${index}`} className="h-4 w-32" />
                    ))}
                  </div>
                </aside>
                <section className="content-area min-w-0 w-full flex-1 space-y-6">
                  <Skeleton className="h-24 w-full rounded-xl" />
                  <div className="grid grid-cols-2 gap-4">
                    {repeat(4).map((_, index) => (
                      <Skeleton
                        key={`mypage-card-${index}`}
                        className="h-28 w-full rounded-xl"
                      />
                    ))}
                  </div>
                </section>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

export function MypageMembershipSkeleton() {
  return (
    <div className="bg-white px-3 py-4 md:min-h-screen md:px-6">
      <Skeleton className="h-6 w-40" />
      <div className="mt-6 space-y-4">
        <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
          <Skeleton className="h-5 w-32" />
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-16 w-full rounded-lg" />
          </div>
        </div>
        <Skeleton className="h-12 w-full rounded-lg" />
        <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-24 w-full rounded-lg" />
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
          <Skeleton className="h-5 w-32" />
          {repeat(3).map((_, index) => (
            <Skeleton key={`membership-history-${index}`} className="h-10 w-full" />
          ))}
        </div>
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
    </div>
  )
}

export function MypagePaymentManagerSkeleton() {
  return (
    <div className="rounded-xl bg-white px-3 pt-4 pb-9 md:px-6">
      <Skeleton className="h-6 w-40" />
      <div className="bg-gray-10 mt-5 mb-4 space-y-4 p-4">
        {repeat(4).map((_, index) => (
          <Skeleton key={`payment-section-${index}`} className="h-20 w-full rounded-lg" />
        ))}
      </div>
      <div className="space-y-3">
        {repeat(4).map((_, index) => (
          <Skeleton key={`payment-menu-${index}`} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    </div>
  )
}

export function MypageProfileSkeleton() {
  return (
    <div className="bg-white px-3 py-4 md:min-h-screen md:px-6">
      <Skeleton className="h-6 w-40" />
      <div className="mt-6 space-y-6">
        <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-4">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-64" />
          <div className="space-y-4">
            {repeat(3).map((_, index) => (
              <FormFieldSkeleton key={`profile-field-${index}`} />
            ))}
          </div>
          <div className="flex justify-end">
            <Skeleton className="h-10 w-24" />
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-4">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-10 w-32" />
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-4">
          <Skeleton className="h-5 w-32" />
          {repeat(2).map((_, index) => (
            <Skeleton key={`profile-address-${index}`} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  )
}

export function MypagePasswordSkeleton() {
  return (
    <div className="bg-white px-3 py-4 md:min-h-screen md:px-6">
      <Skeleton className="h-6 w-32" />
      <div className="mx-auto mt-6 w-full max-w-md space-y-4">
        <Skeleton className="h-4 w-64" />
        {repeat(3).map((_, index) => (
          <FormFieldSkeleton key={`password-field-${index}`} />
        ))}
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-3 w-64 mx-auto" />
      </div>
    </div>
  )
}

export function MypageCafe24Skeleton() {
  return (
    <div className="bg-white px-3 py-4 md:min-h-screen md:px-6">
      <Skeleton className="h-6 w-56" />
      <div className="mt-6 space-y-6">
        <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-4">
          <Skeleton className="h-5 w-32" />
          <div className="grid grid-cols-4 gap-4">
            {repeat(4).map((_, index) => (
              <Skeleton key={`cafe24-head-${index}`} className="h-4 w-20" />
            ))}
          </div>
          {repeat(3).map((_, index) => (
            <div key={`cafe24-row-${index}`} className="grid grid-cols-4 gap-4">
              {repeat(4).map((__, cellIndex) => (
                <Skeleton key={`cafe24-cell-${index}-${cellIndex}`} className="h-4 w-full" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function MypageShopSettingSkeleton() {
  return (
    <div className="px-4 py-4 md:px-6">
      <Skeleton className="h-6 w-40" />
      <div className="mt-6 flex flex-col gap-10 bg-white p-[15px]">
        <div className="space-y-5">
          <Skeleton className="h-5 w-40" />
          <div className="flex gap-2">
            <Skeleton className="h-10 w-24 rounded-[10px]" />
            <Skeleton className="h-10 w-24 rounded-[10px]" />
          </div>
          <Skeleton className="h-4 w-32" />
          <div className="flex items-center gap-3">
            <Skeleton className="h-7 w-7 rounded" />
            <Skeleton className="h-7 w-12 rounded" />
            <Skeleton className="h-7 w-7 rounded" />
            <Skeleton className="h-4 w-8" />
          </div>
        </div>

        <div className="space-y-5">
          <Skeleton className="h-5 w-40" />
          <div className="flex flex-wrap gap-2">
            {repeat(5).map((_, index) => (
              <Skeleton key={`shop-type-${index}`} className="h-10 w-24 rounded-[10px]" />
            ))}
          </div>
        </div>

        <div className="space-y-5">
          <Skeleton className="h-5 w-32" />
          <div className="flex flex-wrap gap-2">
            {repeat(8).map((_, index) => (
              <Skeleton key={`shop-category-${index}`} className="h-9 w-20 rounded-[10px]" />
            ))}
          </div>
        </div>

        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
    </div>
  )
}

export function MypageOrderListSkeleton() {
  return (
    <div className="min-h-screen bg-white px-3 py-4 md:px-6">
      <Skeleton className="h-6 w-32" />
      <section className="my-5">
        <div className="flex gap-2">
          {repeat(4).map((_, index) => (
            <Skeleton key={`order-filter-${index}`} className="h-8 w-20 rounded-full" />
          ))}
        </div>
      </section>
      <section className="space-y-6">
        {repeat(3).map((_, index) => (
          <div key={`order-card-${index}`} className="rounded-xl border border-gray-200 bg-white p-4 space-y-4">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-32" />
            </div>
            <div className="flex gap-4">
              <Skeleton className="h-20 w-20 rounded-md" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-32" />
              </div>
              <Skeleton className="h-8 w-20" />
            </div>
          </div>
        ))}
      </section>
    </div>
  )
}

export function MypageOrderTrackSkeleton() {
  return (
    <div className="bg-gray min-h-screen py-4">
      <div className="px-3 md:px-0 space-y-8">
        <div className="rounded-xl bg-white p-4 space-y-3">
          <Skeleton className="h-4 w-32" />
          <div className="flex items-center justify-between">
            {repeat(5).map((_, index) => (
              <Skeleton key={`track-step-${index}`} className="h-8 w-8 rounded-full" />
            ))}
          </div>
        </div>

        <section>
          <div className="flex items-center justify-between border-b px-3 pb-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-24" />
          </div>
          <div className="rounded-xl bg-white p-6">
            <div className="flex gap-4">
              <Skeleton className="h-24 w-24 rounded-md" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-32" />
              </div>
            </div>
            <Skeleton className="mt-6 h-9 w-full" />
          </div>
        </section>

        <section className="rounded-xl bg-white p-6 space-y-4">
          <Skeleton className="h-5 w-32" />
          {repeat(3).map((_, index) => (
            <Skeleton key={`shipping-row-${index}`} className="h-4 w-full" />
          ))}
        </section>

        <section className="rounded-xl bg-white p-4 space-y-4">
          <Skeleton className="h-5 w-56" />
          {repeat(4).map((_, index) => (
            <Skeleton key={`faq-${index}`} className="h-10 w-full" />
          ))}
        </section>
      </div>
    </div>
  )
}

export function MypagePointSkeleton() {
  return (
    <div className="min-h-screen bg-white">
      <section className="bg-white px-5 pt-6 pb-6">
        <div className="rounded-2xl bg-[#F7F8FA] p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-6 w-20" />
          </div>
          <div className="mb-4 h-px w-full bg-gray-200" />
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-20" />
            </div>
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-20" />
            </div>
          </div>
        </div>
      </section>

      <section className="min-h-[400px] border-t border-gray-100 bg-white">
        <div className="sticky top-0 z-40 border-b border-gray-50 bg-white px-5 py-4">
          <div className="flex gap-2">
            {repeat(3).map((_, index) => (
              <Skeleton key={`point-tab-${index}`} className="h-8 w-16 rounded-full" />
            ))}
          </div>
        </div>
        <ul className="flex flex-col pb-20">
          {repeat(5).map((_, index) => (
            <li key={`point-row-${index}`} className="flex flex-col gap-3 border-b border-gray-50 px-5 py-5">
              <Skeleton className="h-3 w-24" />
              <div className="flex items-start justify-between">
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-3 w-32" />
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

export function MypageExchangeSkeleton() {
  return (
    <div className="bg-white px-3 py-4 md:min-h-screen md:px-6">
      <Skeleton className="h-6 w-40" />
      <section className="space-y-6 mt-6">
        {repeat(2).map((_, index) => (
          <div key={`exchange-card-${index}`} className="rounded-xl border border-gray-200 bg-white p-4 space-y-4">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-20" />
            </div>
            <div className="flex gap-4">
              <Skeleton className="h-20 w-20 rounded-md" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-32" />
              </div>
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-9 w-24" />
              <Skeleton className="h-9 w-24" />
            </div>
          </div>
        ))}
      </section>
    </div>
  )
}

export function MypageDownloadSkeleton() {
  return (
    <div className="px-4 py-4 md:px-6">
      <div className="bg-background min-h-screen">
        <div className="container mx-auto max-w-7xl px-4 py-8">
          <div className="mb-8 space-y-2">
            <Skeleton className="h-7 w-32" />
            <Skeleton className="h-4 w-56" />
          </div>
          <div className="mb-6 flex items-center justify-between">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-9 w-28 rounded-md" />
          </div>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {repeat(6).map((_, index) => (
              <div key={`download-card-${index}`} className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
                <Skeleton className="h-36 w-full rounded-lg" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
          </div>
          <div className="mt-8 flex items-center justify-center gap-2">
            {repeat(5).map((_, index) => (
              <Skeleton key={`download-page-${index}`} className="h-9 w-16 rounded-md" />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function MypageBusinessSkeleton() {
  return (
    <div className="px-4 py-6 md:min-h-screen md:px-8 md:py-8">
      <div className="mb-6 flex items-center gap-3">
        <Skeleton className="h-8 w-8 rounded-md md:hidden" />
      </div>
      <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-4">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-4 w-48" />
        {repeat(3).map((_, index) => (
          <FormFieldSkeleton key={`business-field-${index}`} />
        ))}
        <div className="flex gap-2">
          <Skeleton className="h-10 w-24" />
          <Skeleton className="h-10 w-24" />
        </div>
      </div>
    </div>
  )
}

export function MypagePinSkeleton() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6 rounded-lg border border-gray-200 bg-white p-6">
        <div className="text-center space-y-2">
          <Skeleton className="mx-auto h-6 w-40" />
          <Skeleton className="mx-auto h-4 w-56" />
        </div>
        <div className="flex justify-center gap-2">
          {repeat(6).map((_, index) => (
            <Skeleton key={`pin-dot-${index}`} className="h-3 w-3 rounded-full" />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-3">
          {repeat(12).map((_, index) => (
            <Skeleton key={`pin-key-${index}`} className="h-12 w-full rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-10 w-full rounded-lg" />
      </div>
    </div>
  )
}

export function MypageMembershipSubscribePaymentSkeleton() {
  return (
    <div className="bg-white px-3 py-4 md:min-h-screen md:px-6">
      <Skeleton className="h-6 w-32" />
      <div className="mt-6 grid grid-cols-1 gap-4">
        <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
          <Skeleton className="h-5 w-32" />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Skeleton className="h-24 w-full rounded-lg" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
          <Skeleton className="h-5 w-32" />
          {repeat(3).map((_, index) => (
            <Skeleton key={`benefit-${index}`} className="h-10 w-full rounded-lg" />
          ))}
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
          <Skeleton className="h-5 w-32" />
          <div className="grid grid-cols-2 gap-3">
            {repeat(4).map((_, index) => (
              <Skeleton key={`price-row-${index}`} className="h-4 w-full" />
            ))}
          </div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-10 w-full" />
        </div>
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
    </div>
  )
}

export function MypageRecentSkeleton() {
  return (
    <div className="rounded-xl bg-white px-3 pt-4 pb-9 md:px-6">
      <Skeleton className="h-6 w-32" />
      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        {repeat(8).map((_, index) => (
          <div key={`recent-card-${index}`} className="space-y-3">
            <Skeleton className="aspect-[3/4] w-full rounded-lg" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function MypageRebuySkeleton() {
  return (
    <div className="rounded-xl bg-white px-3 pt-4 pb-9 md:px-6">
      <Skeleton className="h-6 w-32" />
      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        {repeat(8).map((_, index) => (
          <div key={`rebuy-card-${index}`} className="space-y-3">
            <Skeleton className="aspect-[3/4] w-full rounded-lg" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function MypageReviewsSkeleton() {
  return (
    <main className="bg-white px-3 py-4 md:min-h-screen md:px-6">
      <Skeleton className="h-6 w-24" />
      <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-transparent p-1">
        <Skeleton className="h-10 w-full rounded-md" />
        <Skeleton className="h-10 w-full rounded-md" />
      </div>
      <div className="mt-4 space-y-4">
        <Skeleton className="h-20 w-full rounded-lg" />
        <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-4">
          {repeat(3).map((_, index) => (
            <div key={`review-card-${index}`} className="flex gap-4">
              <Skeleton className="h-20 w-20 rounded-md" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-3 w-32" />
              </div>
              <Skeleton className="h-8 w-20" />
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}

export function MypageWishlistSkeleton() {
  return (
    <div className="rounded-xl bg-white px-3 pt-4 pb-9 md:px-6">
      <Skeleton className="h-6 w-32" />
      <div className="mt-4 flex items-center gap-2">
        <Skeleton className="h-4 w-4 rounded-sm" />
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="mt-4 space-y-3">
        {repeat(4).map((_, index) => (
          <div key={`wishlist-item-${index}`} className="flex gap-4 rounded-lg border border-gray-200 bg-white p-4">
            <Skeleton className="h-20 w-20 rounded-md" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-32" />
            </div>
            <Skeleton className="h-8 w-20" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function AdminInventorySkeleton() {
  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="rounded-xl border-2 border-dashed border-gray-300 bg-white p-8 text-center">
          <Skeleton className="mx-auto h-12 w-12 rounded-full" />
          <Skeleton className="mx-auto mt-4 h-4 w-64" />
          <Skeleton className="mx-auto mt-2 h-3 w-48" />
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-3">
          <Skeleton className="h-5 w-32" />
          {repeat(4).map((_, index) => (
            <Skeleton key={`inventory-row-${index}`} className="h-4 w-full" />
          ))}
        </div>
      </div>
    </div>
  )
}

export function MembershipPaymentMethodSkeleton() {
  return (
    <div className="flex min-h-screen flex-col bg-white font-['Pretendard']">
      <div className="mx-auto flex w-full flex-1 flex-col">
        <header className="flex w-full shrink-0 items-center border-b border-gray-200 px-3 py-4 md:px-6 md:py-3">
          <div className="flex-1">
            <Skeleton className="h-6 w-6 rounded-full" />
          </div>
          <div className="flex-1 text-center">
            <Skeleton className="mx-auto h-4 w-40" />
          </div>
          <div className="flex-1" />
        </header>
        <div className="flex-1 overflow-y-auto px-6 py-8">
          <div className="flex flex-col gap-8">
            <section className="space-y-2">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-5 w-48" />
            </section>
            <section className="space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </section>
            <section className="space-y-3">
              <Skeleton className="h-3 w-28" />
              {repeat(2).map((_, index) => (
                <Skeleton key={`card-${index}`} className="h-16 w-full rounded-lg" />
              ))}
            </section>
            <Skeleton className="h-12 w-full rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  )
}

export function MypageEmptyStateSkeleton() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 p-8">
      <Skeleton className="h-24 w-24 rounded-full" />
      <div className="text-center space-y-3">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-80" />
        <Skeleton className="h-3 w-64" />
      </div>
    </div>
  )
}

export function MypageListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <main className="md:bg-muted w-full bg-white">
      <div className="container mx-auto max-w-[1360px]">
        <div className="block md:hidden px-4 py-6 space-y-4">
          <Skeleton className="h-6 w-32" />
          {repeat(rows).map((_, index) => (
            <ListRowSkeleton key={`mypage-mobile-row-${index}`} />
          ))}
        </div>
        <div className="inner hidden md:block md:px-[40px] md:py-10">
          <Skeleton className="mb-6 h-4 w-32" />
          <div className="flex flex-row gap-8">
            <aside className="hidden w-[280px] shrink-0 lg:block">
              <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-6">
                {repeat(6).map((_, index) => (
                  <Skeleton key={`mypage-side-${index}`} className="h-4 w-32" />
                ))}
              </div>
            </aside>
            <section className="content-area min-w-0 w-full flex-1 space-y-4">
              <Skeleton className="h-8 w-48" />
              {repeat(rows).map((_, index) => (
                <ListRowSkeleton key={`mypage-row-${index}`} />
              ))}
            </section>
          </div>
        </div>
      </div>
    </main>
  )
}

export function MypageFormSkeleton({ fields = 4 }: { fields?: number }) {
  return (
    <main className="md:bg-muted w-full bg-white">
      <div className="container mx-auto max-w-[1360px]">
        <div className="block md:hidden px-4 py-6">
          <Skeleton className="mb-4 h-6 w-32" />
          <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
            {repeat(fields).map((_, index) => (
              <FormFieldSkeleton key={`mypage-mobile-field-${index}`} />
            ))}
            <Skeleton className="h-12 w-full" />
          </div>
        </div>
        <div className="inner hidden md:block md:px-[40px] md:py-10">
          <Skeleton className="mb-6 h-4 w-32" />
          <div className="flex flex-row gap-8">
            <aside className="hidden w-[280px] shrink-0 lg:block">
              <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-6">
                {repeat(6).map((_, index) => (
                  <Skeleton key={`mypage-side-${index}`} className="h-4 w-32" />
                ))}
              </div>
            </aside>
            <section className="content-area min-w-0 w-full flex-1 space-y-6 rounded-lg border border-gray-200 bg-white p-6">
              <Skeleton className="h-6 w-40" />
              <div className="space-y-4">
                {repeat(fields).map((_, index) => (
                  <FormFieldSkeleton key={`mypage-field-${index}`} />
                ))}
              </div>
              <Skeleton className="h-12 w-40" />
            </section>
          </div>
        </div>
      </div>
    </main>
  )
}

export function MypageTableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <main className="md:bg-muted w-full bg-white">
      <div className="container mx-auto max-w-[1360px]">
        <div className="block md:hidden px-4 py-6 space-y-4">
          <Skeleton className="h-6 w-32" />
          {repeat(rows).map((_, index) => (
            <ListRowSkeleton key={`mypage-mobile-table-row-${index}`} />
          ))}
        </div>
        <div className="inner hidden md:block md:px-[40px] md:py-10">
          <Skeleton className="mb-6 h-4 w-32" />
          <div className="flex flex-row gap-8">
            <aside className="hidden w-[280px] shrink-0 lg:block">
              <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-6">
                {repeat(6).map((_, index) => (
                  <Skeleton key={`mypage-side-${index}`} className="h-4 w-32" />
                ))}
              </div>
            </aside>
            <section className="content-area min-w-0 w-full flex-1 space-y-4">
              <Skeleton className="h-8 w-48" />
              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="grid grid-cols-4 gap-4">
                  {repeat(4).map((_, index) => (
                    <Skeleton key={`table-head-${index}`} className="h-4 w-20" />
                  ))}
                </div>
                <div className="mt-4 space-y-3">
                  {repeat(rows).map((_, index) => (
                    <div key={`table-row-${index}`} className="grid grid-cols-4 gap-4">
                      {repeat(4).map((__, cellIndex) => (
                        <Skeleton key={`table-cell-${index}-${cellIndex}`} className="h-4 w-full" />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  )
}

export function OrderTrackingSkeleton() {
  return (
    <div className="min-h-screen bg-white">
      <div className="container mx-auto max-w-[1000px] px-4 py-10">
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <Skeleton className="h-6 w-40" />
          <div className="mt-6 space-y-4">
            <FormFieldSkeleton />
            <FormFieldSkeleton />
            <Skeleton className="h-12 w-full" />
          </div>
        </div>

        <div className="mt-8 rounded-xl border border-gray-200 bg-white p-6">
          <Skeleton className="h-6 w-48" />
          <div className="mt-6 flex items-center justify-between">
            {repeat(5).map((_, index) => (
              <Skeleton key={`track-step-${index}`} className="h-10 w-10 rounded-full" />
            ))}
          </div>
        </div>

        <div className="mt-10 space-y-6">
          <SectionTitleSkeleton />
          <ProductGridSkeleton count={4} />
        </div>
      </div>
    </div>
  )
}

export function OrderDetailsSkeleton() {
  return (
    <>
      {/* Mobile */}
      <main className="relative min-h-screen w-full bg-[#f8f8f8] font-sans lg:hidden">
        <div className="p-4 pb-24 space-y-4">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-32" />
          </div>

          <section className="rounded-lg bg-white p-4 space-y-3">
            {repeat(4).map((_, index) => (
              <div key={`mobile-pay-${index}`} className="flex justify-between">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </section>

          <Skeleton className="h-10 w-full rounded-md" />

          <section className="rounded-lg bg-white p-4 space-y-3">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-40" />
            <div className="pt-3 border-t border-gray-200">
              <div className="flex gap-3">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-32" />
              </div>
            </div>
          </section>

          <section className="rounded-lg bg-white p-4 space-y-4">
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-4 w-20" />
            </div>
            <Skeleton className="h-4 w-24" />
            <div className="flex gap-3">
              <Skeleton className="h-20 w-20 rounded-md" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-32" />
              </div>
              <Skeleton className="h-8 w-20" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </section>
        </div>

        <div className="fixed right-4 bottom-24 z-10 flex flex-col gap-2">
          {repeat(3).map((_, index) => (
            <Skeleton key={`floating-${index}`} className="h-12 w-12 rounded-full" />
          ))}
        </div>
      </main>

      {/* Desktop */}
      <div className="hidden lg:block bg-white py-4 font-['Pretendard'] md:px-6">
        <section className="mb-[35px] flex flex-col items-start gap-3.5">
          <Skeleton className="h-7 w-32" />
          <div className="flex w-full max-w-[813px] flex-col gap-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-5 w-56" />
          </div>
        </section>

        <article className="mb-[35px] flex border border-gray-200">
          <div className="flex-1 p-7 space-y-6">
            <Skeleton className="h-7 w-32" />
            <div className="flex flex-wrap items-end gap-6">
              <Skeleton className="h-24 w-24 rounded-[5px]" />
              <div className="flex-1 space-y-3">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-28" />
              </div>
              <Skeleton className="h-9 w-28" />
            </div>
          </div>
          <div className="flex w-40 items-center justify-center border-l border-gray-200 px-7">
            <Skeleton className="h-10 w-full" />
          </div>
        </article>

        <section className="mb-[35px] flex flex-col gap-4">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-px w-full" />
          {repeat(3).map((_, index) => (
            <div key={`desktop-info-${index}`} className="flex items-center gap-16">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-64" />
            </div>
          ))}
        </section>
      </div>
    </>
  )
}

export function AddressListSkeleton() {
  return (
    <div className="min-h-screen bg-white">
      <header className="flex items-center border-b p-4">
        <Skeleton className="h-6 w-6 rounded-full" />
        <div className="flex-grow text-center">
          <Skeleton className="mx-auto h-5 w-24" />
        </div>
        <div className="w-6" />
      </header>

      <div className="container mx-auto max-w-[900px] px-4 py-6">
        <Skeleton className="h-6 w-28" />
        <div className="mt-6 space-y-4">
          {repeat(3).map((_, index) => (
            <div
              key={`address-${index}`}
              className="rounded-lg border border-gray-200 bg-white p-4"
            >
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
              <div className="mt-3 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-2/3" />
              </div>
              <div className="mt-4 flex items-center gap-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function AddressFormSkeleton() {
  return (
    <div className="min-h-screen bg-white">
      <header className="flex items-center border-b p-4">
        <Skeleton className="h-6 w-6 rounded-full" />
        <div className="flex-grow text-center">
          <Skeleton className="mx-auto h-5 w-24" />
        </div>
        <div className="w-6" />
      </header>

      <div className="container mx-auto max-w-[720px] px-4 py-6">
        <Skeleton className="h-6 w-28" />
        <div className="mt-6 space-y-3">
          {repeat(3).map((_, index) => (
            <Skeleton key={`address-input-${index}`} className="h-12 w-full" />
          ))}
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </div>
    </div>
  )
}
