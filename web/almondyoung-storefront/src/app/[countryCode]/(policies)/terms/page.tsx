import { Metadata } from "next"
import { agreements } from "@/lib/data/agreements"

export const metadata: Metadata = {
  title: "이용약관",
}

export default function TermsPage() {
  const termsOfService = agreements.find((a) => a.id === "termsOfService")
  const electronicTransaction = agreements.find(
    (a) => a.id === "electronicTransaction"
  )

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="mb-8 text-2xl font-bold">이용약관</h1>

      {termsOfService?.content && (
        <section className="mb-12">
          <h2 className="mb-4 text-lg font-semibold">
            아몬드영 이용약관
          </h2>
          <div className="text-muted-foreground whitespace-pre-line text-sm leading-relaxed">
            {termsOfService.content}
          </div>
        </section>
      )}

      {electronicTransaction?.content && (
        <section>
          <h2 className="mb-4 text-lg font-semibold">
            전자금융거래 이용약관
          </h2>
          <div className="text-muted-foreground whitespace-pre-line text-sm leading-relaxed">
            {electronicTransaction.content}
          </div>
        </section>
      )}
    </div>
  )
}
