import { getImageProps } from "next/image"

// next.config 의 images.remotePatterns 에 있는 호스트만 최적화기로 보낸다. 없는 호스트를 보내면 400 으로 엑박이 된다.
const OPTIMIZABLE_HOSTS = new Set([
  "almondyoung-demo.s3.ap-northeast-2.amazonaws.com",
  "file.almondyoung.com",
])

const IMG_TAG = /<img\b[^>]*>/gi
const SRC_ATTR = /\ssrc\s*=\s*"([^"]+)"/i
const LOADING_ATTR = /\sloading\s*=/i

function isOptimizable(src: string): boolean {
  try {
    return OPTIMIZABLE_HOSTS.has(new URL(src).hostname)
  } catch {
    return false
  }
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;")
}

/**
 * 카페24 에서 옮겨 온 상세 HTML 은 원본 이미지(장당 0.5~1MB)를 그대로 건다.
 * 모바일 폭에 맞춘 최적화 이미지로 바꾸고, 화면 밖 이미지는 늦게 받게 한다.
 */
export function optimizeDescriptionHtmlImages(html: string): string {
  return html.replace(IMG_TAG, (tag) => {
    let next = LOADING_ATTR.test(tag)
      ? tag
      : tag.replace(/^<img\b/i, '<img loading="lazy" decoding="async"')

    const src = SRC_ATTR.exec(next)?.[1]
    if (!src || !isOptimizable(src)) return next

    const { props } = getImageProps({
      src,
      alt: "",
      width: 860,
      height: 860,
      sizes: "(max-width: 768px) 100vw, 860px",
    })
    next = next.replace(
      SRC_ATTR,
      ` src="${escapeAttr(props.src)}" srcset="${escapeAttr(props.srcSet ?? "")}" sizes="${escapeAttr(props.sizes ?? "")}"`
    )
    return next
  })
}
