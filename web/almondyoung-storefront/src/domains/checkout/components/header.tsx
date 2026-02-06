"use client"

import Link from "next/link"
import Image from "next/image"

export const PCHeader = () => (
  <div className="hidden w-full border-b border-gray-200 bg-white lg:block">
    <div className="relative container mx-auto flex max-w-[1360px] items-center justify-between px-[40px] py-5">
      <Link href="/" className="shrink-0">
        <Image
          src="/images/almond-logo-black.png"
          alt="아몬드영"
          className="h-7 w-auto"
          width={200}
          height={150}
        />
      </Link>
      <h1 className="absolute left-1/2 -translate-x-1/2 transform text-2xl font-bold">
        주문/결제
      </h1>
      <div className="w-[200px] shrink-0"></div>
    </div>

    <div className="container mx-auto max-w-[1360px] px-4 py-3 lg:px-[40px]">
      <div className="flex items-center justify-end gap-2">
        <span className="font-bold text-gray-900">주문/결제</span>
        <svg
          className="h-6 w-6 text-gray-300"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5l7 7-7 7"
          />
        </svg>
        <span className="text-gray-500">완료</span>
      </div>
    </div>
  </div>
)

export const MobileHeader = ({ onClose }: { onClose: () => void }) => (
  <header className="mb-6 flex items-center justify-between pt-6 lg:hidden">
    <h1 className="text-lg font-bold text-gray-900">주문서 작성</h1>
    <button
      aria-label="닫기"
      className="text-xl text-gray-500"
      onClick={onClose}
    >
      ✕
    </button>
  </header>
)
