import { Metadata } from "next"
import { agreements } from "@/lib/data/agreements"

export const metadata: Metadata = {
  title: "개인정보처리방침",
}

export default function PrivacyPage() {
  const privacyPolicy = agreements.find((a) => a.id === "privacyPolicy")
  const thirdPartySharing = agreements.find(
    (a) => a.id === "thirdPartySharing"
  )

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="mb-8 text-2xl font-bold">개인정보처리방침</h1>

      {privacyPolicy?.content && (
        <section className="mb-12">
          <h2 className="mb-4 text-lg font-semibold">
            개인정보 수집 및 이용
          </h2>
          <div className="text-muted-foreground whitespace-pre-line text-sm leading-relaxed">
            {privacyPolicy.content}
          </div>
        </section>
      )}

      {thirdPartySharing?.content && (
        <section>
          <h2 className="mb-4 text-lg font-semibold">
            개인정보 제3자 제공
          </h2>
          <div className="text-muted-foreground whitespace-pre-line text-sm leading-relaxed">
            {thirdPartySharing.content}
          </div>
        </section>
      )}
    </div>
  )
}
