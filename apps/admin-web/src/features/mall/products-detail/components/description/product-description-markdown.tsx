'use client';

import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkDirective from 'remark-directive';
import remarkGfm from 'remark-gfm';
import {
  fitCropToAspect,
  parseImageCrop,
  type ImageCrop,
} from '@packages/product-description/directive';
import { remarkProductDescription } from '@packages/product-description/remark-blocks';
import '@packages/product-description/description-blocks.css';
import { resolvePublicFileUrl } from '@/lib/utils/file-url';
import { ProductDescriptionImage } from './product-description-image';
import {
  PRODUCT_FILE_URL_PREFIX,
  productDescriptionUrlTransform,
} from './product-description-rendering';

// 스토어프론트와 같은 블록 해석을 쓴다. 다른 점은 깨진 이미지를 지우지 않고 진단 자리표시로 남기는 것뿐이다.
const plugins = [
  remarkGfm,
  remarkDirective,
  remarkProductDescription({
    resolveImageUrl: (fileId) => `${PRODUCT_FILE_URL_PREFIX}${fileId}`,
    invalidImage: ({ fileId, alt, reason }) => ({
      type: 'image',
      url: `${PRODUCT_FILE_URL_PREFIX}${fileId ?? 'invalid'}`,
      alt: alt ?? '상품 상세 이미지',
      data: {
        hProperties: {
          ...(fileId ? { 'data-product-image-file-id': fileId } : {}),
          'data-product-image-error': reason,
        },
      },
    }),
  }),
];

type ProductImageProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  node?: { properties?: Record<string, unknown> };
  'data-product-image-file-id'?: string;
  'data-product-image-error'?: string;
};

export function ProductDescriptionMarkdown({ value }: { value: string }) {
  return (
    <div className="pd-root prose prose-sm max-w-none">
      <ReactMarkdown
        remarkPlugins={plugins}
        urlTransform={productDescriptionUrlTransform}
        components={{
          img: ({ node, ...props }: ProductImageProps) => {
            const src = typeof props.src === 'string' ? props.src : '';
            if (!src.startsWith(PRODUCT_FILE_URL_PREFIX)) {
              return (
                <ProductDescriptionImage
                  fileId={null}
                  alt={props.alt ?? ''}
                  error="raw_url_image_not_supported"
                />
              );
            }

            const error = props['data-product-image-error'] ?? null;
            const fileId = error
              ? (props['data-product-image-file-id'] ?? null)
              : src.slice(PRODUCT_FILE_URL_PREFIX.length);
            const crop = parseImageCrop(node?.properties?.dataCrop);
            const url = fileId ? resolvePublicFileUrl(fileId) : null;

            if (!error && crop && url) {
              return (
                <CroppedImage
                  src={url}
                  alt={props.alt ?? ''}
                  crop={crop}
                  aspect={Number(node?.properties?.dataAspect) || undefined}
                />
              );
            }

            return (
              <ProductDescriptionImage
                fileId={fileId}
                alt={props.alt ?? ''}
                error={error}
                className={props.className}
              />
            );
          },
        }}
      >
        {value}
      </ReactMarkdown>
    </div>
  );
}

/**
 * 원본 이미지의 일부(crop)만 보여 준다. 스토어프론트 product-description-markdown.tsx 의 CroppedImage 와
 * 같은 동작이다 — 계산(fitCropToAspect)은 공용 패키지에 있고, 여기는 화면에 놓는 일만 한다.
 */
function CroppedImage({
  src,
  alt,
  crop,
  aspect,
}: {
  src: string;
  alt: string;
  crop: ImageCrop;
  aspect?: number;
}) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // 이미 받아진 이미지는 onLoad 가 안 올 수 있어 마운트 때 한 번 직접 읽는다.
  useEffect(() => {
    const loaded = imgRef.current?.complete ? naturalSize(imgRef.current) : null;
    if (loaded) setSize(loaded);
  }, []);

  const shown = size && aspect ? fitCropToAspect(crop, size.width, size.height, aspect) : crop;
  const ratio = aspect ?? (size ? (crop.w * size.width) / (crop.h * size.height) : crop.w / crop.h);

  return (
    <span className="pd-crop" style={{ aspectRatio: ratio }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- 원본 확대·이동이라 next/image 의 고정 크기와 맞지 않는다 */}
      <img
        src={src}
        alt={alt}
        ref={imgRef}
        loading="lazy"
        onLoad={(event) => {
          const loaded = naturalSize(event.currentTarget);
          if (loaded) setSize(loaded);
        }}
        style={{
          opacity: aspect && !size ? 0 : 1,
          width: `${100 / shown.w}%`,
          left: `${(-shown.x / shown.w) * 100}%`,
          top: `${(-shown.y / shown.h) * 100}%`,
        }}
      />
    </span>
  );
}

function naturalSize(img: HTMLImageElement) {
  return img.naturalWidth && img.naturalHeight
    ? { width: img.naturalWidth, height: img.naturalHeight }
    : null;
}
