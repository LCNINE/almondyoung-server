"use client"

import Image from "next/image"
import ReactMarkdown from "react-markdown"
import remarkDirective from "remark-directive"
import remarkGfm from "remark-gfm"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import { remarkProductImageDirective } from "./remark-product-image"

const plugins = [
  remarkGfm,
  remarkDirective,
  remarkProductImageDirective(getThumbnailUrl),
]

export function ProductDescriptionMarkdown({ markdown }: { markdown: string }) {
  return (
    <div className="prose max-w-none">
      <ReactMarkdown
        remarkPlugins={plugins}
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
