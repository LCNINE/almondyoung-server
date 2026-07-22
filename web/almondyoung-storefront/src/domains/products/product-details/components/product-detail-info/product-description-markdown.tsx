"use client"

import {
  parseProductImageDirective,
  PRODUCT_IMAGE_DIRECTIVE_NAME,
} from "@packages/product-description"
import Image from "next/image"
import ReactMarkdown from "react-markdown"
import remarkDirective from "remark-directive"
import remarkGfm from "remark-gfm"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"

type MarkdownNode = {
  type?: string
  name?: string
  attributes?: Record<string, unknown> | null
  children?: MarkdownNode[]
  url?: string
  alt?: string
}

/**
 * 어드민 상세설명 에디터가 저장하는 `::product-image{fileId=... alt=...}` 디렉티브를
 * 일반 마크다운 이미지 노드로 바꾼다. (어드민 product-description-markdown.tsx 와 동일 계약)
 */
function remarkProductImageDirective() {
  return (tree: MarkdownNode) => {
    const walk = (node: MarkdownNode) => {
      const children = node.children
      if (!children) return

      children.forEach((child, index) => {
        const isDirective =
          child.type === "leafDirective" ||
          child.type === "textDirective" ||
          child.type === "containerDirective"

        if (isDirective && child.name === PRODUCT_IMAGE_DIRECTIVE_NAME) {
          const parsed = parseProductImageDirective(child)
          // 깨진 디렉티브는 조용히 제거 — 스토어프론트엔 진단 UI 불필요
          children[index] = parsed.ok
            ? {
                type: "image",
                url: getThumbnailUrl(parsed.fileId),
                alt: parsed.alt,
              }
            : { type: "text", children: [] }
        }

        walk(child)
      })
    }

    walk(tree)
  }
}

export function ProductDescriptionMarkdown({ markdown }: { markdown: string }) {
  return (
    <div className="prose max-w-none">
      <ReactMarkdown
        remarkPlugins={[
          remarkGfm,
          remarkDirective,
          remarkProductImageDirective,
        ]}
        components={{
          img: ({ src, alt }) =>
            typeof src === "string" && src ? (
              <Image
                src={src}
                alt={alt ?? ""}
                className="h-auto w-full object-contain"
                loading="lazy"
                width={860}
                height={860}
                sizes="(max-width: 768px) 100vw, 860px"
              />
            ) : null,
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  )
}
