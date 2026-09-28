import { createShopListingMarkdownOptions } from '@packages/shop-listing-markdown';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

// 스토어프론트와 같은 규칙 한 벌 — 여기서 더하거나 바꾸지 말 것(app-wiring.spec.ts 가 막는다).
const options = createShopListingMarkdownOptions({ remarkGfm, remarkBreaks });

export function ShopListingMarkdown({ value }: { value: string }) {
  return (
    <div className="prose prose-sm max-w-none">
      <ReactMarkdown {...options}>{value}</ReactMarkdown>
    </div>
  );
}
