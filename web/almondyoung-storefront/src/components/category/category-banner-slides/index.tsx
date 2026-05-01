"use client"

import React, { useEffect, useMemo, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react"
import Link from "next/link"

export interface CategoryBannerSlide {
  id: string
  title?: string
  subtitle?: string
  image: string
  mobileImage?: string
  link?: string
  theme?: "light"
  bgColor?: string
}

interface CategoryBannerSliderProps {
  slides?: CategoryBannerSlide[]
  intervalMs?: number
  pauseOnHover?: boolean
  showProductThumbs?: boolean
  showProducts?: boolean
  maxProductsDesktop?: number
  maxProductsTablet?: number
  maxProductsMobile?: number
}

const CategoryBannerSlider: React.FC<CategoryBannerSliderProps> = ({
  slides,
  intervalMs = 4000,
  pauseOnHover = true,
  showProducts = true,
  maxProductsDesktop = 2,
  maxProductsTablet = 2,
}) => {
  const [paused, setPaused] = useState(false)
  const [progress, setProgress] = useState(0)
  const [containerWidth, setContainerWidth] = useState(0)
  const [isMd, setIsMd] = useState(false)
  const [isLg, setIsLg] = useState(false)
  const [isXl, setIsXl] = useState(false)
  const [isSm, setIsSm] = useState(false)

  const rootRef = useRef<HTMLDivElement | null>(null)
  const frameRef = useRef<number | null>(null)
  const startRef = useRef<number>(0)
  const touchX = useRef<number | null>(null)

  // ---------- Mock ----------
  const defaultSlides: CategoryBannerSlide[] = useMemo(
    () => [
      {
        id: "1",
        title: "[MAKE.NXFrom Peach] <br> 퍼스트솔루션",
        subtitle: "신제품 바로 구매하기",
        image:
          "https://makenail.co.kr/web/product/medium/202509/64946670d678863c5e4c8780762836c8.jpg",
        mobileImage:
          "https://makenail.co.kr/web/product/medium/202509/64946670d678863c5e4c8780762836c8.jpg",
        link: "/category/nail/nail-art-tools",
      },
      {
        id: "2",
        title: "디테일 살려주는 <br> 실전용 아트 보조템",
        subtitle: "네일 퀄리티를 좌우하는 아이템",
        image:
          "https://m.nailzone.co.kr/web/product/medium/202304/81f493630055653b65d178c806eff256.jpg",
        mobileImage:
          "https://m.nailzone.co.kr/web/product/medium/202304/81f493630055653b65d178c806eff256.jpg",
        link: "/category/nail/nail-art-tools",
      },
      {
        id: "3",
        title: "메이유어 가을네일 추천",
        subtitle: "알림받기 + 리뷰 이벤트",
        image:
          "https://makenail.co.kr/web/product/medium/202509/49bf4b33c4438b2b80acffe9326441ab.jpg",
        mobileImage:
          "https://makenail.co.kr/web/product/medium/202509/49bf4b33c4438b2b80acffe9326441ab.jpg",
        theme: "light",
        link: "/category/nail/nail-art-tools",
      },
      {
        id: "4",
        title: "국가 고시",
        subtitle: "국가 고시 준비중이라면",
        image:
          "https://almondyoung.com/web/product/big/202405/ade8e16d452c519edd1b433e2b711ee0.png",
        mobileImage:
          "https://almondyoung.com/web/product/big/202405/ade8e16d452c519edd1b433e2b711ee0.png",
        theme: "light",
        link: "/category/nail/nail-art-tools",
      },
      {
        id: "5",
        title: "가을 네일 특가",
        subtitle: "가을 네일 아몬드영 특가 진행중",
        image: "https://100uksister.com/_detail/dg/dryrose_detail_01.jpg",
        mobileImage: "https://100uksister.com/_detail/dg/dryrose_detail_01.jpg",
        link: "/category/nail/nail-art-tools",
      },
    ],
    []
  )
  const baseSlides = slides?.length ? slides : defaultSlides
  const trackRef = useRef<HTMLUListElement | null>(null)

  // ----- 브레이크포인트 -----
  useEffect(() => {
    const onResize = () => {
      const w = window.innerWidth
      setIsXl(w >= 1280)
      setIsLg(w >= 1024 && w < 1280)
      setIsMd(w >= 768 && w < 1024)
      setIsSm(w >= 376 && w < 768)
    }

    // 즉시 실행
    onResize()

    // 리사이즈 이벤트 리스너 등록
    window.addEventListener("resize", onResize)

    return () => {
      window.removeEventListener("resize", onResize)
    }
  }, [])

  // ---------- Measure container ----------
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const e of entries)
        setContainerWidth(Math.round(e.contentRect.width))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ---------- View policy ----------
  const slidesPerView = isXl ? 4 : isLg ? 3 : 2
  const leftPeek = isXl ? 120 : isLg ? 100 : isMd ? 100 : isSm ? 40 : 40
  const rightPeek = isXl ? 120 : isLg ? 100 : isMd ? 100 : isSm ? 40 : 40
  const gapPx = isXl ? 4 : isLg ? 4 : isMd ? 4 : 4

  const slideWidth = Math.max(
    200,
    (containerWidth - leftPeek - rightPeek - gapPx * (slidesPerView - 1)) /
      slidesPerView
  )
  const step = slideWidth + gapPx
  const height = isXl ? 330 : isLg ? 310 : isMd ? 300 : isSm ? 240 : 230

  // ----- (1) 페이지 패딩: N이 v의 배수가 아니면 뒤를 채움 -----
  const normalizedSlides = useMemo(() => {
    const N = baseSlides.length
    if (N === 0) return []
    const v = slidesPerView
    const r = N % v
    if (r === 0) return baseSlides
    const need = v - r
    // 앞쪽에서 need개를 복제해 뒤를 채움 (키만 다르게)
    const pads = baseSlides
      .slice(0, need)
      .map((s, i) => ({ ...s, id: `${s.id}__pad${i}` }))
    return [...baseSlides, ...pads]
  }, [baseSlides, slidesPerView])

  // ----- (2) 양끝 클론으로 확장 -----
  const extended = useMemo(() => {
    if (!normalizedSlides.length) return []
    const v = slidesPerView
    return [
      ...normalizedSlides.slice(-v),
      ...normalizedSlides,
      ...normalizedSlides.slice(0, v),
    ]
  }, [normalizedSlides, slidesPerView])

  // 시작 인덱스는 "앞쪽 클론들" 뒤
  const [index, setIndex] = useState(() => slidesPerView)
  const [withTransition, setWithTransition] = useState(true)

  // 브레이크포인트가 바뀌면 인덱스 리셋(깨짐 방지)
  useEffect(() => {
    setWithTransition(false)
    setIndex(slidesPerView)
    requestAnimationFrame(() => setWithTransition(true))
  }, [slidesPerView])

  // ----- (3) 트랙 위치: 왼쪽 peek 기준으로 정렬 (가운데 자동 유지) -----
  // slideWidth 계산에 peek을 이미 반영했으므로 별도 center 보정 불필요
  const trackStyle: React.CSSProperties = {
    gap: `${gapPx}px`,
    transform: `translate3d(${leftPeek - index * step}px, 0, 0)`, // 핵심
    transition: withTransition ? "transform 500ms ease" : "none",
  }
  const handleTransitionEnd = () => {
    const v = slidesPerView
    const N = normalizedSlides.length
    const min = v
    const max = v + N

    if (index >= max || index < min) {
      const newIndex = index >= max ? index - N : index + N
      setWithTransition(false) // 트랜지션 끔
      setIndex(newIndex) // 위치 보정

      // --- 강제 리플로우: 현재 transform을 즉시 확정(페인트)
      //    이렇게 해야 보정 프레임이 화면에 "정지된 상태"로 찍힘
      //    (jump 모션 0)
      const el = trackRef.current
      if (el) {
        void el.offsetHeight
      } // <-- 강제 리플로우

      // 다음 프레임에 트랜지션 다시 켬
      requestAnimationFrame(() => setWithTransition(true))
    }
  }

  // ----- 컨트롤 -----
  const next = () => {
    setWithTransition(true)
    setIndex((i) => i + slidesPerView)
    setProgress(0)
    startRef.current = 0
  }
  const prev = () => {
    setWithTransition(true)
    setIndex((i) => i - slidesPerView)
    setProgress(0)
    startRef.current = 0
  }
  const go = (pageIdx: number) => {
    // pageIdx: 0..(pages-1)
    setWithTransition(true)
    setIndex(slidesPerView + pageIdx * slidesPerView)
    setProgress(0)
    startRef.current = 0
  }

  // ----- 페이지/접근성 -----
  const pages = Math.ceil(normalizedSlides.length / slidesPerView)
  const logical =
    (((index - slidesPerView) % normalizedSlides.length) +
      normalizedSlides.length) %
    normalizedSlides.length
  const currentPage = Math.floor(logical / slidesPerView) + 1
  const ariaLabel = `전체 ${pages}페이지 중 ${currentPage}페이지`

  // ----- Autoplay (선택) -----
  const prefersReduced =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

  useEffect(() => {
    if (paused || prefersReduced || normalizedSlides.length <= slidesPerView)
      return
    const duration = intervalMs
    const loop = (t: number) => {
      if (!startRef.current) startRef.current = t
      const elapsed = t - startRef.current
      const rate = Math.min(elapsed / duration, 1)
      setProgress(rate * 100)
      if (rate >= 1) {
        startRef.current = 0
        setProgress(0)
        setWithTransition(true)
        setIndex((i) => i + slidesPerView)
      } else {
        frameRef.current = requestAnimationFrame(loop)
      }
    }
    frameRef.current = requestAnimationFrame(loop)
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
      startRef.current = 0
    }
  }, [
    paused,
    prefersReduced,
    intervalMs,
    slidesPerView,
    normalizedSlides.length,
  ])

  // ----- Hover/Pan -----
  const hoverHandlers = pauseOnHover
    ? {
        onMouseEnter: () => setPaused(true),
        onMouseLeave: () => setPaused(false),
      }
    : {}

  const onTouchStart = (e: React.TouchEvent) => {
    touchX.current = e.touches[0].clientX
  }
  const onTouchMove = (e: React.TouchEvent) => {
    if (touchX.current === null) return
    const dx = e.touches[0].clientX - touchX.current
    if (Math.abs(dx) > 60) {
      touchX.current = null
      dx > 0 ? prev() : next()
    }
  }
  const onTouchEnd = () => (touchX.current = null)

  // ---------- Render ----------
  const maxWidthClassName = "w-full"

  return (
    <section className="w-full">
      <div className="relative mx-auto w-full pb-6" ref={rootRef}>
        <div
          className="relative mb-10 overflow-hidden"
          style={{ height }}
          {...hoverHandlers}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          aria-roledescription="carousel"
          aria-label="카테고리 프로모션 배너"
        >
          {/* 트랙 */}
          <ul
            ref={trackRef}
            className="absolute inset-0 flex items-center will-change-transform"
            style={trackStyle}
            aria-live="polite"
            onTransitionEnd={handleTransitionEnd}
          >
            {extended.map((s, i) => (
              <li
                key={`${s.id}__${i}`}
                className="relative shrink-0 overflow-hidden bg-neutral-200"
                // ⛔ 중앙 깨뜨리던 max-w 제거
                style={{ width: `${slideWidth}px`, height: "100%" }}
              >
                <div className="relative h-full w-full">
                  {s.bgColor && (
                    <div
                      className="absolute inset-0"
                      style={{ backgroundColor: s.bgColor }}
                    />
                  )}
                  <img
                    src={
                      !isLg && !isMd && s.mobileImage ? s.mobileImage : s.image
                    }
                    alt={s.subtitle || s.title || "promotion banner"}
                    className="absolute inset-0 h-full w-full object-cover"
                    loading={i === 0 ? "eager" : "lazy"}
                  />

                  {/* 그라데이션 오버레이 */}
                  <div className="absolute inset-0 bg-stone-800/20"></div>

                  {/* 메인 배너 링크 영역 */}
                  <Link href={s.link ?? "#"} className="absolute inset-0 z-10">
                    <span className="sr-only">{s.title || "배너 링크"}</span>
                  </Link>

                  {(s.title || s.subtitle) && (
                    <div
                      className={`absolute inset-0 flex items-end pb-6 md:pb-8`}
                    >
                      <div className={`px-4 text-white md:px-6`}>
                        {s.title && (
                          <h1
                            className="text-[20px] leading-tight font-bold drop-shadow-[1.5px_1.5px_1px_rgba(0,0,0,0.4)] md:text-[22px] lg:text-[26px]"
                            dangerouslySetInnerHTML={{ __html: s.title }}
                          />
                        )}
                        {s.subtitle && (
                          <p className="mt-2 flex items-center gap-2 text-sm opacity-90 md:text-base">
                            {s.subtitle}{" "}
                            <span>
                              <ChevronRight className="h-5 w-5" />
                            </span>
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {/* 좌/우 버튼 */}
          <div className="pointer-events-none absolute inset-y-0 right-0 left-0 flex items-center justify-between">
            <button
              onClick={prev}
              aria-label="이전 배너"
              className="pointer-events-auto ml-2 rounded-full bg-white/85 p-2 shadow hover:bg-white"
            >
              <ChevronLeft className="h-5 w-5 text-neutral-800" />
            </button>
            <button
              onClick={next}
              aria-label="다음 배너"
              className="pointer-events-auto mr-2 rounded-full bg-white/85 p-2 shadow hover:bg-white"
            >
              <ChevronRight className="h-5 w-5 text-neutral-800" />
            </button>
          </div>

          {/* //진행바/페이지/재생
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
            <div className="flex items-center gap-3 rounded-full bg-white/95 px-4 py-2 shadow">
              <div className="relative h-[3px] w-28 overflow-hidden rounded-full bg-neutral-200 md:w-40">
                <span
                  className="absolute top-0 left-0 h-full bg-neutral-800 transition-[width] duration-100"
                  style={{ width: `${progress}%` }}
                />
                <span className="sr-only">{`전체 ${normalizedSlides.length} 중 ${logical + 1}`}</span>
              </div>
              <span className="min-w-[48px] text-center text-sm text-neutral-600">
                {currentPage} / {pages}
              </span>
              <button
                onClick={() => setPaused((p) => !p)}
                className="rounded-full p-2 hover:bg-neutral-100"
                aria-label={paused ? "자동재생 시작" : "자동재생 정지"}
              >
                {paused ? (
                  <Play className="h-4 w-4" />
                ) : (
                  <Pause className="h-4 w-4" />
                )}
              </button>
            </div>
          </div> */}
        </div>

        {/* 페이지 점 */}
        <div className="mt-3 flex justify-center gap-2">
          {Array.from({ length: pages }, (_, i) => (
            <button
              key={i}
              onClick={() => go(i)}
              className={`h-2 rounded-full transition-all ${i === Math.floor(logical / slidesPerView) ? "w-8 bg-neutral-800" : "w-2 bg-neutral-300"}`}
              aria-label={`${i + 1}페이지로 이동`}
            />
          ))}
        </div>

        <p className="sr-only" aria-live="polite">
          {ariaLabel}
        </p>
      </div>
    </section>
  )
}

export default CategoryBannerSlider
