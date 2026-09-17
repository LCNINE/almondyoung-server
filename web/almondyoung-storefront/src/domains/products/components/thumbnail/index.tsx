import { cn } from "@/lib/utils"
import React from "react"

import PlaceholderImage from "@/icons/placeholder-image"
import ThumbnailImage from "./thumbnail-image"
import { StoreProductImage } from "@medusajs/types"
import { PhotoSwipeFrame } from "@/components/shared/photo-swipe-frame"

/** 카드 하나에서 미리 보여줄 사진 수. 더 늘리면 구역이 좁아 조준이 어렵다. */
const MAX_PREVIEW = 5

/**
 * 카드가 넘겨볼 수 있는 사진 목록.
 * 대표 사진이 images[0] 과 같은 파일이라 그대로 이어 붙이면 첫 장이 바뀌지 않는다.
 */
export function listPhotoUrls(
  thumbnail?: string | null,
  images?: StoreProductImage[] | null
) {
  const gallery = (images ?? [])
    .map((image) => image.url)
    .filter((url): url is string => Boolean(url))

  return thumbnail
    ? [thumbnail, ...gallery.filter((url) => url !== thumbnail)]
    : gallery
}

type ThumbnailProps = {
  thumbnail?: string | null
  images?: StoreProductImage[] | null
  size?: "small" | "medium" | "large" | "full" | "square"
  className?: string
  "data-testid"?: string
  overlay?: React.ReactNode
  /** 가로로 넘기는 줄 안에 든 카드는 손짓이 겹쳐 사진 넘기기를 끈다 */
  enableSwipe?: boolean
}

const Thumbnail: React.FC<ThumbnailProps> = ({
  thumbnail,
  images,
  size = "small",
  className,
  "data-testid": dataTestid,
  overlay,
  enableSwipe = true,
}) => {
  const shown = listPhotoUrls(thumbnail, images).slice(0, MAX_PREVIEW)

  return (
    <div
      className={cn(
        // 패딩은 이미지 자체(object-contain)에 주고, 박스는 고정 정사각 영역만 담당한다.
        "shadow-elevation-card-rest rounded-large group-hover:shadow-elevation-card-hover relative aspect-square w-full overflow-hidden bg-white transition-shadow duration-150 ease-in-out",
        className,
        {
          "w-[180px]": size === "small",
          "w-[290px]": size === "medium",
          "w-[440px]": size === "large",
          "w-full": size === "full",
        }
      )}
      data-testid={dataTestid}
    >
      {shown.length > 1 ? (
        <PhotoSwipeFrame
          count={shown.length}
          renderImage={(index) => (
            <ThumbnailImage image={shown[index]} size={size} />
          )}
          itemClassName="aspect-square"
          enableSwipe={enableSwipe}
        />
      ) : (
        <ImageOrPlaceholder image={shown[0]} size={size} />
      )}


      {overlay}
    </div>
  )
}

const ImageOrPlaceholder = ({
  image,
  size,
}: Pick<ThumbnailProps, "size"> & { image?: string }) => {
  return image ? (
    <ThumbnailImage image={image} size={size} />
  ) : (
    <div className="absolute inset-0 flex h-full w-full items-center justify-center">
      <PlaceholderImage size={size === "small" ? 16 : 24} />
    </div>
  )
}

export default Thumbnail
