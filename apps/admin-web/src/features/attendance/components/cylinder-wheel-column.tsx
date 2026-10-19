'use client';

import {
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from 'react';

const ROW_HEIGHT = 44;
const WHEEL_ANGLE = (26 * Math.PI) / 180;
const WHEEL_RADIUS = ROW_HEIGHT / WHEEL_ANGLE;

function cylinderStyle(offset: number) {
  const bounded = Math.max(-3.4, Math.min(3.4, offset));
  const angle = bounded * WHEEL_ANGLE;
  const curvedY = Math.sin(angle) * WHEEL_RADIUS;
  const depth = (Math.cos(angle) - 1) * WHEEL_RADIUS;
  const shift = curvedY - offset * ROW_HEIGHT;

  return {
    transform: `perspective(400px) translateY(${shift}px) translateZ(${depth}px) rotateX(${-bounded * 26}deg)`,
    opacity:
      Math.abs(offset) > 3.4 ? 0 : Math.pow(Math.max(0, Math.cos(angle)), 1.3),
    transformOrigin: 'center',
    backfaceVisibility: 'hidden' as const,
  };
}
export function CylinderWheelColumn({
  ref: externalRef,
  label,
  options: baseOptions,
  loop = false,
  value,
  onChange,
}: {
  ref?: Ref<{ getValue: () => number }>;
  label: string;
  loop?: boolean;
  options: { value: number; label: string }[];
  value: number;
  onChange: (value: number) => void;
}) {
  const options = loop
    ? Array.from(
        { length: baseOptions.length * 101 },
        (_, index) => baseOptions[index % baseOptions.length]
      )
    : baseOptions;
  const center = loop ? baseOptions.length * 50 : 0;
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const pointerDown = useRef(false);
  const touchActive = useRef(false);
  const frame = useRef<number | null>(null);
  const pendingTarget = useRef<number | null>(null);
  const userInteracting = useRef(false);
  const lastTick = useRef({ index: -1, at: 0 });
  const paintedPosition = useRef<number | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selected =
    center +
    Math.max(
      0,
      options.findIndex((option) => option.value === value)
    );

  const [anchor, setAnchor] = useState(selected);
  const windowStart = Math.max(0, Math.min(options.length - 1, anchor) - 5);
  const windowEnd = Math.min(options.length, anchor + 6);
  const visibleOptions = options.slice(windowStart, windowEnd);

  useImperativeHandle(externalRef, () => ({
    getValue: () => {
      const index = Math.round(
        (ref.current?.scrollTop ?? selected * ROW_HEIGHT) / ROW_HEIGHT
      );

      return options[Math.max(0, Math.min(options.length - 1, index))].value;
    },
  }));

  useEffect(() => {
    const element = ref.current;

    if (element && Math.abs(element.scrollTop - selected * ROW_HEIGHT) > 1) {
      element.scrollTop = selected * ROW_HEIGHT;
    }

    setAnchor(selected);
    paint(selected);
    lastTick.current.index = selected;
    // External value changes align the same wheel; scrolling is painted per frame.
  }, [selected]);

  useEffect(
    () => () => {
      if (settleTimer.current) {
        clearTimeout(settleTimer.current);
      }

      if (frame.current !== null) {
        cancelAnimationFrame(frame.current);
      }
    },
    []
  );

  function paint(position: number) {
    const element = ref.current;

    if (!element) {
      return;
    }

    for (const item of Array.from(trackRef.current?.children ?? [])) {
      const index = Number((item as HTMLElement).dataset.index);
      const glyph = item.firstElementChild as HTMLElement | null;

      if (glyph) {
        const style = cylinderStyle(index - position);

        glyph.style.transform = style.transform;
        glyph.style.opacity = String(style.opacity);
      }
    }

    paintedPosition.current = position;
  }

  function tick(index: number) {
    if (lastTick.current.index === index) {
      return;
    }

    lastTick.current.index = index;
    const now = performance.now();

    if (!userInteracting.current || now - lastTick.current.at < 45) {
      return;
    }

    lastTick.current.at = now;

    if (typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(8);
      } catch {
        // Unsupported or restricted haptics never interrupt selection.
      }
    }
  }

  function moveTo(index: number) {
    const next = Math.max(0, Math.min(options.length - 1, index));
    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;

    userInteracting.current = true;
    pendingTarget.current = next;
    ref.current?.scrollTo({
      top: next * ROW_HEIGHT,
      behavior: reducedMotion ? 'instant' : 'smooth',
    });
  }

  function handleScroll() {
    if (frame.current === null) {
      frame.current = requestAnimationFrame(() => {
        const position = (ref.current?.scrollTop ?? 0) / ROW_HEIGHT;

        setAnchor(
          Math.max(0, Math.min(options.length - 1, Math.round(position)))
        );
        paint(position);
        tick(Math.max(0, Math.min(options.length - 1, Math.round(position))));
        frame.current = null;
      });
    }

    if (settleTimer.current) {
      clearTimeout(settleTimer.current);
    }

    settleTimer.current = setTimeout(() => {
      if (pointerDown.current || touchActive.current) {
        return;
      }

      const element = ref.current;
      const index = Math.max(
        0,
        Math.min(
          options.length - 1,
          Math.round((element?.scrollTop ?? 0) / ROW_HEIGHT)
        )
      );
      const option = options[index];

      if (element && Math.abs(element.scrollTop - index * ROW_HEIGHT) > 0.5) {
        element.scrollTo({ top: index * ROW_HEIGHT, behavior: 'smooth' });

        return;
      }

      pendingTarget.current = null;

      if (loop && element) {
        const centeredIndex = center + (index % baseOptions.length);

        element.scrollTop = centeredIndex * ROW_HEIGHT;
        setAnchor(centeredIndex);
        paint(centeredIndex);
      }

      onChange(option.value);
      userInteracting.current = false;
    }, 160);
  }

  return (
    <div className="relative min-w-0 flex-1">
      <div
        ref={ref}
        role="listbox"
        aria-label={label}
        aria-activedescendant={`${id}-${Math.max(windowStart, Math.min(windowEnd - 1, anchor))}`}
        tabIndex={0}
        data-vaul-no-drag
        onKeyDown={(event) => {
          const delta =
            event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;

          if (delta) {
            event.preventDefault();
            const current =
              pendingTarget.current ??
              Math.round(
                (ref.current?.scrollTop ?? selected * ROW_HEIGHT) / ROW_HEIGHT
              );

            moveTo(current + delta);
          }
        }}
        onPointerDown={() => {
          pendingTarget.current = null;
          pointerDown.current = true;
          userInteracting.current = true;
        }}
        onPointerUp={() => {
          pointerDown.current = false;
          handleScroll();
        }}
        onPointerCancel={() => {
          pointerDown.current = false;
        }}
        onTouchStart={() => {
          touchActive.current = true;
          userInteracting.current = true;
        }}
        onTouchEnd={() => {
          touchActive.current = false;
          handleScroll();
        }}
        onTouchCancel={() => {
          touchActive.current = false;
          handleScroll();
        }}
        onWheel={() => {
          pendingTarget.current = null;
          userInteracting.current = true;
        }}
        onScroll={handleScroll}
        className="relative h-[220px] overflow-x-hidden overflow-y-auto overscroll-y-contain touch-pan-y text-center [scrollbar-width:none] [-webkit-overflow-scrolling:touch] [&::-webkit-scrollbar]:hidden focus-visible:rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        style={{
          maskImage:
            'linear-gradient(to bottom, transparent, black 35%, black 65%, transparent)',
        }}
      >
        <div
          ref={trackRef}
          className="relative w-full"
          style={{ height: options.length * ROW_HEIGHT + 176 }}
        >
          {visibleOptions.map((option, offset) => {
            const index = windowStart + offset;

            return (
              <button
                key={index}
                id={`${id}-${index}`}
                type="button"
                role="option"
                aria-selected={
                  index === Math.round(paintedPosition.current ?? selected)
                }
                aria-posinset={(index % baseOptions.length) + 1}
                aria-setsize={baseOptions.length}
                data-index={index}
                tabIndex={-1}
                onClick={(event) => {
                  const element = ref.current;

                  if (!element || event.detail === 0) {
                    moveTo(index);

                    return;
                  }

                  const y =
                    event.clientY - element.getBoundingClientRect().top - 110;
                  const angle = Math.asin(
                    Math.max(-1, Math.min(1, y / WHEEL_RADIUS))
                  );
                  const position = element.scrollTop / ROW_HEIGHT;

                  moveTo(Math.round(position + angle / WHEEL_ANGLE));
                }}
                className="absolute inset-x-0 block h-11 w-full text-center text-xl font-medium tabular-nums text-slate-950 select-none"
                style={{ top: 88 + index * ROW_HEIGHT }}
              >
                <span
                  className="pointer-events-none inline-block motion-reduce:transition-none"
                  style={cylinderStyle(
                    index - (paintedPosition.current ?? selected)
                  )}
                >
                  {option.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
