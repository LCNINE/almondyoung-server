'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

type Props = {
  categories: string[];
  value: string | null;
  onChange: (value: string | null) => void;
};

const SCROLL_STEP = 240;

export function CategoryTabs({ categories, value, onChange }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ left: false, right: false });

  const drag = useRef({
    active: false,
    startX: 0,
    startScroll: 0,
    moved: false,
  });
  const [dragging, setDragging] = useState(false);

  const sync = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdge({
      left: el.scrollLeft > 1,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
    });
  }, []);

  useEffect(() => {
    sync();
    const el = ref.current;
    if (!el) return;
    const onResize = () => sync();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [categories.length, sync]);

  // 세로 휠을 가로 스크롤로 — 마우스 사용자는 이게 없으면 넘친 탭에 닿지 못한다
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      if (el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
      sync();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [sync]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    drag.current = {
      active: true,
      startX: e.clientX,
      startScroll: el.scrollLeft,
      moved: false,
    };
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || !drag.current.active) return;
    const dx = e.clientX - drag.current.startX;
    if (Math.abs(dx) > 3) drag.current.moved = true;
    el.scrollLeft = drag.current.startScroll - dx;
    sync();
  };

  const endDrag = () => {
    if (!drag.current.active) return;
    drag.current.active = false;
    setDragging(false);
    // 클릭 핸들러가 먼저 도는 것을 피하려고 다음 tick 에 푼다
    window.setTimeout(() => {
      drag.current.moved = false;
    }, 0);
  };

  const step = (dir: -1 | 1) => {
    ref.current?.scrollBy({ left: dir * SCROLL_STEP, behavior: 'smooth' });
    window.setTimeout(sync, 300);
  };

  return (
    <div className="relative mb-4 border-b border-[#e4e4e7]">
      <div
        ref={ref}
        onScroll={sync}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        className={`flex overflow-x-auto select-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
          dragging
            ? 'cursor-grabbing'
            : edge.left || edge.right
              ? 'cursor-grab'
              : ''
        }`}
      >
        <Tab
          active={value === null}
          onSelect={() => !drag.current.moved && onChange(null)}
        >
          전체
        </Tab>
        {categories.map((c) => (
          <Tab
            key={c}
            active={value === c}
            onSelect={() => !drag.current.moved && onChange(c)}
          >
            {c}
          </Tab>
        ))}
      </div>

      {edge.left && <Arrow side="left" onClick={() => step(-1)} />}
      {edge.right && <Arrow side="right" onClick={() => step(1)} />}
    </div>
  );
}

function Arrow({
  side,
  onClick,
}: {
  side: 'left' | 'right';
  onClick: () => void;
}) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === 'left' ? '이전 카테고리' : '다음 카테고리'}
      className={`absolute top-0 bottom-px flex w-9 items-center bg-gradient-to-${
        side === 'left' ? 'r' : 'l'
      } from-white via-white to-transparent ${
        side === 'left' ? 'left-0 justify-start' : 'right-0 justify-end'
      }`}
    >
      <span className="flex h-6 w-6 items-center justify-center rounded-full border border-[#e4e4e7] bg-white shadow-sm">
        <Icon className="h-4 w-4 text-[#52525b]" />
      </span>
    </button>
  );
}

function Tab({
  active,
  onSelect,
  children,
}: {
  active: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`min-w-[100px] shrink-0 border-b-2 px-4 pb-3 text-center text-[16px] font-semibold whitespace-nowrap transition-colors ${
        active
          ? 'border-[#007aff] text-[#007aff]'
          : 'border-transparent text-black'
      }`}
    >
      {children}
    </button>
  );
}
