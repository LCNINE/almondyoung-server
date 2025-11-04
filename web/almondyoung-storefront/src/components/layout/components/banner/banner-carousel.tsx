"use client";

import * as React from "react";
import Image from "next/image";
import { cn } from "@lib/utils";
import { Button } from "@components/common/ui/button";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";


export type Slide = {
  id: string | number;
  image: {
    src: string;
    alt: string;
    priority?: boolean;
  };
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  href?: string;
  ctaLabel?: string;
  // 배경/오버레이 커스터마이즈
  className?: string; // 섹션 배경용
  overlayClassName?: string; // 텍스트 영역 박스용
};

type BannerCarouselProps = {
  slides: Slide[];
  autoPlay?: boolean;
  autoPlayInterval?: number; // ms
  aspectRatio?: `${number}/${number}`; // ex) "21/9", "16/9"
  height?: string | number; // 직접 높이 지정 (ex: "400px", 400)
  className?: string;
};

export function BannerCarousel({
  slides,
  autoPlay = true,
  autoPlayInterval = 4000,
  aspectRatio = "21/9",
  height,
  className,
}: BannerCarouselProps) {
  const [index, setIndex] = React.useState(0);
  const [isPlaying, setIsPlaying] = React.useState(autoPlay);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const touchStartX = React.useRef<number | null>(null);
  const touchDeltaX = React.useRef(0);

  const count = slides.length;

  // 이동 함수
  const goTo = React.useCallback(
    (next: number) => {
      const safe = ((next % count) + count) % count;
      setIndex(safe);
    },
    [count]
  );
  const next = React.useCallback(() => goTo(index + 1), [goTo, index]);
  const prev = React.useCallback(() => goTo(index - 1), [goTo, index]);

  // 자동재생 (사용자 선호: 감소된 모션 고려)
  React.useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!isPlaying || media.matches) return;
    const id = window.setInterval(next, autoPlayInterval);
    return () => window.clearInterval(id);
  }, [isPlaying, autoPlayInterval, next]);

  // hover 시 일시정지
  const onMouseEnter = () => setIsPlaying(false);
  const onMouseLeave = () => setIsPlaying(true);

  // 키보드 내비게이션
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight") next();
    if (e.key === "ArrowLeft") prev();
  };

  // 터치 스와이프
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchDeltaX.current = 0;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current == null) return;
    touchDeltaX.current = e.touches[0].clientX - touchStartX.current;
  };
  const onTouchEnd = () => {
    const delta = touchDeltaX.current;
    touchStartX.current = null;
    touchDeltaX.current = 0;
    if (Math.abs(delta) > 50) {
      delta < 0 ? next() : prev();
    }
  };

  return (
    <section
      ref={containerRef}
      className={cn("relative w-full select-none", className)}
      aria-roledescription="carousel"
      aria-label="프로모션 배너"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onKeyDown={onKeyDown}
      tabIndex={0}
    >
      {/* 뷰포트 */}
      <div className="overflow-hidden">
        <ul
          className="flex transition-transform duration-500 ease-out"
          style={{ transform: `translateX(-${index * 100}%)` }}
        >
          {slides.map((s, i) => (
            <li
              key={s.id}
              className={cn(
                "relative min-w-full",
                // 원하는 비율 유지
                "grid",
              )}
            >
              <div
                className={cn(
                  "relative w-full",
                  // aspect-ratio 유지를 위한 컨테이너
                  "overflow-hidden",
                  s.className
                )}
                style={{
                  ...(height ? { height: typeof height === 'number' ? `${height}px` : height } : { aspectRatio }),
                }}
              >
                <Image
                  src={s.image.src}
                  alt={s.image.alt}
                  fill
                  priority={s.image.priority}
                  className="object-cover"
                  sizes="100vw"
                />

                {/* 텍스트 오버레이 */}
                <div
                  className={cn(
                    "absolute inset-0",
                    "flex items-center",
                    "bg-gradient-to-r from-black/40 via-black/20 to-transparent",
                  )}
                >
                  <div
                    className={cn(
                      "mx-auto px-6",
                      "text-white max-w-[1200px] text-center"
                    )}
                  >
                    <div
                      className={cn(
                        "inline-flex max-w-[720px] flex-col gap-1",
                        "backdrop-blur-[0px]",
                        s.overlayClassName
                      )}
                    >
                      {s.title ? (
                        <span className="text-[24px] md:text-[30px] font-extrabold leading-tight">
                          {s.title}
                        </span>
                      ) : null}
                      {s.subtitle ? (
                        <p className="text-base md:text-lg/relaxed opacity-90">
                          {s.subtitle}
                        </p>
                      ) : null}
                      {/* {s.href && s.ctaLabel ? (
                        <div className="pt-2">
                          <Button asChild size="lg" className="rounded-full">
                            <a href={s.href} aria-label={`${s.ctaLabel} 이동`}>
                              {s.ctaLabel}
                            </a>
                          </Button>
                        </div>
                      ) : null} */}
                    </div>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* 좌우 화살표 */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-between px-2 opacity-50">
        <Button
          variant="secondary"
          size="icon"
          className="pointer-events-auto rounded-full shadow-lg"
          onClick={prev}
          aria-label="이전 배너"
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <Button
          variant="secondary"
          size="icon"
          className="pointer-events-auto rounded-full shadow-lg"
          onClick={next}
          aria-label="다음 배너"
        >
          <ChevronRight className="h-5 w-5" />
        </Button>
      </div>

      {/* 하단 컨트롤: 점 + 재생/일시정지
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2">
        <div className="flex items-center gap-1">
          {slides.map((_, i) => {
            const active = i === index;
            return (
              <button
                key={i}
                onClick={() => goTo(i)}
                aria-label={`${i + 1}번째 배너로 이동`}
                className={cn(
                  "h-2 w-2 rounded-full transition-all",
                  active ? "w-6 bg-white" : "bg-white/60 hover:bg-white/90"
                )}
              />
            );
          })}
        </div>
      </div> */}
    </section>
  );
}
