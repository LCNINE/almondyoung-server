import { cn } from "@/lib/utils"
import React from "react"

import PlaceholderImage from "@/icons/placeholder-image"
import ThumbnailImage from "./thumbnail-image"
import { StoreProductImage } from "@medusajs/types"

type ThumbnailProps = {
  thumbnail?: string | null
  images?: StoreProductImage[] | null
  size?: "small" | "medium" | "large" | "full" | "square"
  className?: string
  "data-testid"?: string
  overlay?: React.ReactNode
}

const Thumbnail: React.FC<ThumbnailProps> = ({
  thumbnail,
  images,
  size = "small",
  className,
  "data-testid": dataTestid,
  overlay,
}) => {
  const initialImage = thumbnail || images?.[0]?.url

  return (
    <div
      className={cn(
        "bg-ui-bg-subtle shadow-elevation-card-rest rounded-large group-hover:shadow-elevation-card-hover relative aspect-square w-full overflow-hidden p-4 transition-shadow duration-150 ease-in-out",
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
      <ImageOrPlaceholder image={initialImage} size={size} />
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
