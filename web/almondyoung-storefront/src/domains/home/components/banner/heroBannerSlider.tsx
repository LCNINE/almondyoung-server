"use client"

import React, { useEffect, useMemo, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react"
import Link from "next/link"

export interface HeroBannerSlide {
  id: string
  title?: string
  subtitle?: string
  image: string
  mobileImage?: string
  link?: string
  theme?: "light"
  bgColor?: string
  products?: Array<{
    id: string
    name: string
    priceText?: string
    image: string
    link?: string
  }>
}

interface HeroBannerSliderProps {
  slides?: HeroBannerSlide[]
  intervalMs?: number
  pauseOnHover?: boolean
  showProductThumbs?: boolean
  showProducts?: boolean
  maxProductsDesktop?: number
  maxProductsTablet?: number
  maxProductsMobile?: number
}

const HeroBannerSlider: React.FC<HeroBannerSliderProps> = ({
  slides,
  intervalMs = 4000,
  pauseOnHover = true,
  showProductThumbs = true,
  showProducts = true,
  maxProductsDesktop = 2,
  maxProductsTablet = 2,
  maxProductsMobile = 1,
}) => {
  const [paused, setPaused] = useState(false)
  const [progress, setProgress] = useState(0)
  const [containerWidth, setContainerWidth] = useState(0)
  const [isMd, setIsMd] = useState(false)
  const [isLg, setIsLg] = useState(false)

  const rootRef = useRef<HTMLDivElement | null>(null)
  const frameRef = useRef<number | null>(null)
  const startRef = useRef<number>(0)
  const touchX = useRef<number | null>(null)

  // ---------- Mock ----------
  const defaultSlides: HeroBannerSlide[] = useMemo(
    () => [
      {
        id: "1",
        title:
          "최저가로, 빠르게, <br> 미용 전문 재료를 <br> 아몬드영 한 곳에서",
        subtitle: "미용 전문 재료를 아몬드영 한 곳에서",
        image:
          "https://permablend.com/cdn/shop/products/PermaBlend-LUXE-Ready-Set-Go-08_1.png?v=1663274919&width=1946",
        mobileImage:
          "https://permablend.com/cdn/shop/products/PermaBlend-LUXE-Ready-Set-Go-08_1.png?v=1663274919&width=1946",
      },
      {
        id: "2",
        title: "디테일 살려주는 <br> 실전용 아트 보조템",
        subtitle: "네일 퀄리티를 좌우하는 아이템",
        image:
          "https://m.nailzone.co.kr/web/product/medium/202304/81f493630055653b65d178c806eff256.jpg",
        mobileImage:
          "https://m.nailzone.co.kr/web/product/medium/202304/81f493630055653b65d178c806eff256.jpg",
        products: [
          {
            id: "p1",
            name: "상품A",
            image:
              "https://almondyoung.com/web/product/big/202501/e700261ff655b8fde3785ea8973f1ce3.jpg",
            priceText: "₩29,900",
          },
          {
            id: "p2",
            name: "상품B",
            image:
              "https://almondyoung.com/web/product/big/202412/74d808f55e8a8bd45bc279777ff7532e.jpg",
            priceText: "₩39,900",
          },
        ],
      },
      {
        id: "3",
        title: "관심 제품",
        subtitle: "혹시 관심 있는 제품이 있으신가요?",
        image:
          "https://i.pinimg.com/1200x/bf/3c/58/bf3c58aba36e5f105e684895736f870f.jpg",
        mobileImage:
          "https://i.pinimg.com/1200x/bf/3c/58/bf3c58aba36e5f105e684895736f870f.jpg",
        theme: "light",
        products: [
          {
            id: "p3",
            name: "상품A",
            image:
              "https://almondyoung.com/web/product/medium/202402/9b57c6aa76f40052f31f2ea85c6876a7.jpg",
            priceText: "₩29,900",
          },
          {
            id: "p4",
            name: "상품B",
            image:
              "https://almondyoung.com/web/product/medium/202506/bfac8b89c0bfdf9d30553e56ee7ce9f8.png",
            priceText: "₩39,900",
          },
        ],
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
        products: [
          {
            id: "p9",
            name: "상품A",
            image:
              "https://almondyoung.com/web/product/medium/202507/25ca9a5c9b206760f451c4ec3b5aa326.jpg",
            priceText: "₩29,900",
          },
          {
            id: "p10",
            name: "상품B",
            image:
              "https://almondyoung.com/web/product/medium/202411/4ee37bc9db2caea2788dd9823073cb86.jpg",
            priceText: "₩39,900",
          },
        ],
      },
      {
        id: "5",
        title: "가을 네일 특가",
        subtitle: "가을 네일 아몬드영 특가 진행중",
        image: "https://100uksister.com/_detail/dg/dryrose_detail_01.jpg",
        mobileImage: "https://100uksister.com/_detail/dg/dryrose_detail_01.jpg",
        products: [
          {
            id: "p5",
            name: "상품A",
            image:
              "data:image/jpeg;base64,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",
            priceText: "₩29,900",
          },
          {
            id: "p6",
            name: "상품B",
            image:
              "https://lh3.googleusercontent.com/proxy/nyvt9YEjXDbpf9dY1Tw3WkYeu5W0SUQ05dIMOCFY8xII3awjMOaoh5zEIoDG1tj8YLYp54G-dF7unPQZxEJkb6SOH-ymZPKub3NCChc7KFOs6Ng-tU4Bc8PFS7PQHU7UBkkTS0A-RLp_1B97",
            priceText: "₩39,900",
          },
        ],
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
      setIsLg(w >= 1024)
      setIsMd(w >= 768 && w < 1024)
    }
    onResize()
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
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
  const slidesPerView = isLg ? 3 : isMd ? 2 : 1
  const leftPeek = isLg ? 42 : isMd ? 80 : 50
  const rightPeek = isLg ? 42 : isMd ? 80 : 50
  const gapPx = isLg ? 10 : isMd ? 10 : 8

  const slideWidth = Math.max(
    240,
    (containerWidth - leftPeek - rightPeek - gapPx * (slidesPerView - 1)) /
      slidesPerView
  )
  const step = slideWidth + gapPx
  const height = isLg ? 540 : isMd ? 500 : 320

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
      <div className="relative mx-auto w-full py-6" ref={rootRef}>
        <div
          className="relative overflow-hidden"
          style={{ height }}
          {...hoverHandlers}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          aria-roledescription="carousel"
          aria-label="메인 프로모션 배너"
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
                className="relative shrink-0 overflow-hidden rounded-2xl bg-neutral-200"
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
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent"></div>

                  {/* 메인 배너 링크 영역 */}
                  <Link href={s.link ?? "#"} className="absolute inset-0 z-10">
                    <span className="sr-only">{s.title || "배너 링크"}</span>
                  </Link>

                  {(s.title || s.subtitle) && (
                    <div
                      className={`absolute inset-0 flex items-end ${showProducts && s.products?.length ? "pb-40" : "pb-8"}`}
                    >
                      <div
                        className={`px-6 text-white`}
                      >
                        {s.title && (
                          <h3
                            className="text-[22px] leading-tight font-bold md:text-[26px] lg:text-[34px]"
                            dangerouslySetInnerHTML={{ __html: s.title }}
                          />
                        )}
                        {s.subtitle && (
                          <p className="mt-2 text-sm opacity-90 md:text-base">
                            {s.subtitle}
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {showProducts && s.products?.length ? (
                    <div className="absolute bottom-6 left-6 z-20">
                      <ul className="flex gap-3">
                        {s.products
                          .slice(
                            0,
                            isLg ? maxProductsDesktop : maxProductsTablet
                          )
                          .map((p) => (
                            <li key={p.id}>
                              <Link
                                href={p.link ?? "#"}
                                className="block md:w-[120px] w-[90px] rounded-xl hover:shadow-lg"
                              >
                                <div className="aspect-square w-full overflow-hidden rounded-md">
                                  <img
                                    src={p.image}
                                    alt={p.name}
                                    className="h-full w-full object-contain"
                                    loading="lazy"
                                  />
                                </div>
                                {/* <p className="mt-2 line-clamp-2 text-xs text-neutral-800">{p.name}</p>
                                  {p.priceText && <p className="mt-1 text-sm font-semibold text-neutral-900">{p.priceText}</p>} */}
                              </Link>
                            </li>
                          ))}
                      </ul>
                    </div>
                  ) : null}
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

export default HeroBannerSlider
