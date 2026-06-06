'use client';

import ReactMarkdown from 'react-markdown';
import remarkDirective from 'remark-directive';
import remarkGfm from 'remark-gfm';
import {
  parseProductImageDirective,
  PRODUCT_IMAGE_DIRECTIVE_NAME,
} from '@packages/product-description';
import { ProductDescriptionImage } from './product-description-image';
import {
  PRODUCT_FILE_URL_PREFIX,
  productDescriptionUrlTransform,
} from './product-description-rendering';

type MutableNode = {
  type?: string;
  name?: string;
  attributes?: Record<string, unknown> | null;
  children?: MutableNode[];
  url?: string;
  alt?: string;
  data?: { hProperties?: Record<string, unknown> };
};

function isDirective(node: MutableNode): boolean {
  return (
    node.type === 'leafDirective' ||
    node.type === 'textDirective' ||
    node.type === 'containerDirective'
  );
}

function getStringAttribute(node: MutableNode, name: string): string | null {
  const value = node.attributes?.[name];
  return typeof value === 'string' ? value : null;
}

function remarkProductImageDirective() {
  return (tree: MutableNode) => {
    const walk = (node: MutableNode) => {
      const children = node.children;
      if (!children) return;

      children.forEach((child, index) => {
        if (isDirective(child) && child.name === PRODUCT_IMAGE_DIRECTIVE_NAME) {
          const parsed = parseProductImageDirective(child);
          if (parsed.ok) {
            children[index] = {
              type: 'image',
              url: `${PRODUCT_FILE_URL_PREFIX}${parsed.fileId}`,
              alt: parsed.alt,
              data: {
                hProperties: {
                  'data-product-image-file-id': parsed.fileId,
                },
              },
            };
          } else {
            const fileId = getStringAttribute(child, 'fileId');
            children[index] = {
              type: 'image',
              url: `${PRODUCT_FILE_URL_PREFIX}${fileId ?? 'invalid'}`,
              alt: getStringAttribute(child, 'alt') ?? '상품 상세 이미지',
              data: {
                hProperties: {
                  ...(fileId ? { 'data-product-image-file-id': fileId } : {}),
                  'data-product-image-error': parsed.reason,
                },
              },
            };
          }
          return;
        }

        walk(child);
      });
    };

    walk(tree);
  };
}

type ProductImageProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  'data-product-image-file-id'?: string;
  'data-product-image-error'?: string;
};

export function ProductDescriptionMarkdown({ value }: { value: string }) {
  return (
    <div className="prose prose-sm max-w-none">
      <ReactMarkdown
        remarkPlugins={[
          remarkGfm,
          remarkDirective,
          remarkProductImageDirective,
        ]}
        urlTransform={productDescriptionUrlTransform}
        components={{
          img: (props: ProductImageProps) => {
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

            return (
              <ProductDescriptionImage
                fileId={props['data-product-image-file-id'] ?? null}
                alt={props.alt ?? ''}
                error={props['data-product-image-error'] ?? null}
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
