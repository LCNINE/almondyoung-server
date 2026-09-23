import { createShopListingMarkdownOptions } from "@packages/shop-listing-markdown"
import ReactMarkdown from "react-markdown"
import remarkBreaks from "remark-breaks"
import remarkGfm from "remark-gfm"
import { cn } from "@/lib/utils"

// 규칙은 패키지 한 곳에 있다. 여기서 플러그인·urlTransform·components 를 더하거나 바꾸지 말 것 —
// packages/shop-listing-markdown/app-wiring.spec.ts 가 막는다. hook 이 없어 서버·클라이언트 양쪽에서 쓴다.
const options = createShopListingMarkdownOptions({ remarkGfm, remarkBreaks })

export function ShopListingMarkdown({
  content,
  className,
}: {
  content: string
  className?: string
}) {
  return (
    <div
      className={cn(
        "prose prose-sm text-foreground max-w-none leading-relaxed",
        className
      )}
    >
      <ReactMarkdown {...options}>{content}</ReactMarkdown>
    </div>
  )
}
