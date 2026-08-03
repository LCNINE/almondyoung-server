"use client"

import PlaceholderImage from "@/icons/placeholder-image"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import Image from "next/image"
import { useState } from "react"

type ThumbnailImageProps = {
  image: string
  size?: "small" | "medium" | "large" | "full" | "square"
}

export default function ThumbnailImage({ image, size }: ThumbnailImageProps) {
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
      // 원본 비율이 제각각이라도 카드 크기가 달라 보이지 않도록,
      // 고정된 정사각 영역 안에서 일정한 패딩을 두고 전체가 보이게(contain) 렌더한다.
      className="absolute inset-0 h-full w-full object-contain object-center p-3 sm:p-4"
      draggable={false}
      quality={50}
      sizes="(max-width: 576px) 280px, (max-width: 768px) 360px, (max-width: 992px) 480px, 800px"
      fill
      onError={() => setError(true)}
    />
  )
}
