// import { Container, clx } from "@medusajs/ui"
import Image from "next/image"
import React from "react"

// import PlaceholderImage from "@modules/common/icons/placeholder-image"

type ThumbnailProps = {
  thumbnail?: string | null
  // TODO: Fix image typings
  images?: any[] | null
  size?: "small" | "medium" | "large" | "full" | "square"
  isFeatured?: boolean
  className?: string
  "data-testid"?: string
}

const Thumbnail: React.FC<ThumbnailProps> = ({
  thumbnail,
  images,
  size = "small",
  isFeatured,
  className,
  "data-testid": dataTestid,
}) => {
  const initialImage = thumbnail || images?.[0]?.url

  return (
    <div
      className={`relative w-full overflow-hidden p-4 bg-muted shadow-md rounded-lg group-hover:shadow-lg transition-shadow ease-in-out duration-150 ${
        className || ""
      } ${
        isFeatured
          ? "aspect-[11/14]"
          : size !== "square"
          ? "aspect-[9/16]"
          : "aspect-[1/1]"
      } ${
        size === "small"
          ? "w-[180px]"
          : size === "medium"
          ? "w-[290px]"
          : size === "large"
          ? "w-[440px]"
          : "w-full"
      }`}
      data-testid={dataTestid}
    >
      <ImageOrPlaceholder image={initialImage} size={size} />
    </div>
  )
}

const ImageOrPlaceholder = ({
  image,
  size,
}: Pick<ThumbnailProps, "size"> & { image?: string }) => {
  return image ? (
    <Image
      src={image}
      alt="Thumbnail"
      className="absolute inset-0 object-cover object-center"
      draggable={false}
      quality={50}
      sizes="(max-width: 576px) 280px, (max-width: 768px) 360px, (max-width: 992px) 480px, 800px"
      fill
    />
  ) : (
    <div className="w-full h-full absolute inset-0 flex items-center justify-center">
      <div className="w-8 h-8 bg-gray-300 rounded flex items-center justify-center">
        <span className="text-gray-500 text-xs">이미지</span>
      </div>
    </div>
  )
}

export default Thumbnail
