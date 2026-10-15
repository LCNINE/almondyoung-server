"use client"

import PlaceholderImage from "@/icons/placeholder-image"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import Image from "next/image"
import { useState } from "react"

type ThumbnailImageProps = {
  image: string
  size?: "small" | "medium" | "large" | "full" | "square"
  /** 첫 화면에 보이는 카드. lazy 를 끄고 먼저 받는다 */
  priority?: boolean
}

export default function ThumbnailImage({
  image,
  size,
  priority,
}: ThumbnailImageProps) {
  const [error, setError] = useState(false)

  if (error) {
    return (
      <div className="absolute inset-0 flex h-full w-full items-center justify-center">
        <PlaceholderImage size={size === "small" ? 16 : 24} />
      </div>
    )
  }

  return (
    <Image
      src={getThumbnailUrl(image)}
      alt="Thumbnail"
      className="absolute inset-0 h-full w-full object-cover object-center"
      draggable={false}
      quality={50}
      sizes="(max-width: 1023px) 50vw, (max-width: 1279px) 33vw, 25vw"
      priority={priority}
      fill
      onError={() => setError(true)}
    />
  )
}
