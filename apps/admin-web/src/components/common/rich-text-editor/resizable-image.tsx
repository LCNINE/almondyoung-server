'use client';

/* eslint-disable @next/next/no-img-element -- Tiptap NodeView 는 DOM 을 직접 제어하므로 next/image 사용 불가 */

import { type MouseEvent as ReactMouseEvent, useRef } from 'react';
import Image from '@tiptap/extension-image';
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from '@tiptap/react';
import { cn } from '@/lib/utils/ui';

const MIN_WIDTH = 60;

function ResizableImageView({
  node,
  updateAttributes,
  selected,
  editor,
}: NodeViewProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const { src, alt, title, width } = node.attrs;

  // 우하단 핸들 드래그 → 현재 렌더 너비 기준으로 width 속성 갱신
  const startResize = (e: ReactMouseEvent) => {
    e.preventDefault();
    const img = imgRef.current;
    if (!img) return;
    const startX = e.clientX;
    const startWidth = img.offsetWidth;

    const onMove = (ev: globalThis.MouseEvent) => {
      const next = Math.max(MIN_WIDTH, startWidth + (ev.clientX - startX));
      updateAttributes({ width: Math.round(next) });
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  return (
    <NodeViewWrapper className="my-2">
      <span className="group relative inline-block">
        <img
          ref={imgRef}
          src={src}
          alt={alt ?? ''}
          title={title ?? undefined}
          width={width ?? undefined}
          draggable={false}
          className={cn(
            'block rounded',
            selected && 'outline outline-2 outline-primary'
          )}
        />
        {editor.isEditable && (
          <span
            role="presentation"
            onMouseDown={startResize}
            className="absolute right-1 bottom-1 h-3 w-3 cursor-nwse-resize rounded-sm border-2 border-white bg-primary opacity-0 transition-opacity group-hover:opacity-100"
          />
        )}
      </span>
    </NodeViewWrapper>
  );
}

/**
 * 기본 Image 확장에 width 속성 + 드래그 리사이즈 NodeView 를 추가한다.
 * width 는 px 정수로 <img width="..."> 속성에 저장된다(스토어프론트 sanitize 의 width 허용과 일치).
 * 본문 너비를 넘는 값은 .rich-text-content img { max-width: 100% } 가 시각적으로 제한한다.
 */
export const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element) => {
          const w = element.getAttribute('width');
          return w ? parseInt(w, 10) : null;
        },
        renderHTML: (attributes) => {
          if (!attributes.width) return {};
          return { width: attributes.width };
        },
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView);
  },
});
