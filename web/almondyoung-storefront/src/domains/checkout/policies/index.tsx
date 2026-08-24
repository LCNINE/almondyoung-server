import { PrivacyPolicy } from "./privacy-policy"
import policies from "./policies.json"

export type PolicyDocKey = "terms" | "privacy" | "guide"

export function PolicyDocument({ docKey }: { docKey: PolicyDocKey }) {
  if (docKey === "privacy") {
    return (
      <div className="text-[14px] leading-relaxed text-gray-700">
        <PrivacyPolicy />
      </div>
    )
  }

  if (docKey === "terms") {
    return (
      <div className="space-y-8">
        {policies.terms.map((section) => (
          <section key={section.title}>
            <h3 className="mb-3 text-[15px] font-bold text-gray-900">
              {section.title}
            </h3>
            <p className="text-[13px] leading-relaxed whitespace-pre-line text-gray-600">
              {section.body}
            </p>
          </section>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {policies.guide.map((section) => (
        <section key={section.title}>
          <h3 className="mb-3 text-[15px] font-bold text-gray-900">
            {section.title}
          </h3>
          <ul className="list-inside list-disc space-y-1.5 text-[13px] leading-relaxed text-gray-600">
            {section.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
