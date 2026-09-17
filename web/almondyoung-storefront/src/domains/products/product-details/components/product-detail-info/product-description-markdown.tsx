"use client"

import Image from "next/image"
import ReactMarkdown from "react-markdown"
import remarkDirective from "remark-directive"
import remarkGfm from "remark-gfm"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import { Badge } from "@/components/ui/badge"
import { parseHashtagParagraph } from "./hashtag-paragraph"
import { remarkProductImageDirective } from "./remark-product-image"

const plugins = [
  remarkGfm,
  remarkDirective,
  remarkProductImageDirective(getThumbnailUrl),
]

export function ProductDescriptionMarkdown({
  markdown,
  imageAltFallback,
}: {
  markdown: string
  /** 이미지 지시자에 alt 가 없을 때 쓸 대체 텍스트 (보통 상품명) */
  imageAltFallback?: string
}) {
  return (
    <div className="prose max-w-none">
      <ReactMarkdown
        remarkPlugins={plugins}
        components={{
          img: ({ src, alt }) =>
            typeof src === "string" && src ? (
              <Image
                src={src}
                alt={alt || imageAltFallback || ""}
                className="h-auto w-full object-contain"
                loading="lazy"
                width={860}
                height={860}
                sizes="(max-width: 768px) 100vw, 860px"
              />
            ) : null,
          p: ({ node, children }) => {
            const text = node?.children.every((c) => c.type === "text")
              ? node.children.map((c) => (c.type === "text" ? c.value : "")).join("")
              : ""
            const tags = parseHashtagParagraph(text)

            if (!tags) return <p>{children}</p>

            return (
              <div className="not-prose mt-6 flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <Badge
                    key={tag}
                    variant="secondary"
                    className="font-normal text-gray-500"
                  >
                    {tag}
                  </Badge>
                ))}
              </div>
            )
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  )
}
