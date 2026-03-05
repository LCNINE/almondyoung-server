"use client";

import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type BoxMap = Record<number, number>;

export default function PickingListPage() {
  const router = useRouter();
  
  // 선택 박스 & 수량(원본 스샷과 동일)
  const boxData: BoxMap = useMemo(
    () => ({ 1: 50, 4: 50, 7: 100, 11: 250, 14: 150 }),
    []
  );
  const [selected, setSelected] = useState<number[]>([1, 4, 7, 11, 14]);

  const toggle = (n: number) =>
    setSelected((prev) =>
      prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n]
    );

  return (
    <main className="mx-auto min-h-screen max-w-[480px] bg-white px-5 pb-12 pt-2">
      {/* 헤더 */}
      <header className="border-b border-[#EAEAEA] pb-3 pt-2">
        <div className="flex items-center justify-between">
          <button
            aria-label="뒤로가기"
            className="h-7 w-7 rounded-full text-[18px] leading-none text-gray-600"
            onClick={() => router.back()}
          >
            ×
          </button>
          <h1 className="text-[18px] font-bold leading-none text-[#111827]">
            피킹리스트 1회차
          </h1>
          <div className="h-7 w-7" />
        </div>
      </header>

      {/* 메타 + 프로그레스 */}
      <section className="pt-3">
        <p className="text-base font-normal not-italic leading-tight text-left text-gray-600">
          날짜: 2025-07-08 <span className="px-1 text-gray-400">|</span>{" "}
          출고지시 수: 20 <span className="px-1 text-gray-400">|</span> 상품 수:
          840
        </p>

        <div className="mt-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-base font-medium text-gray-600">피킹률</span>
            <span className="text-[12px] font-medium text-gray-500">0%</span>
          </div>

          {/* iOS 느낌의 얇은 트랙 + 원형 핸들 */}
          <div className="relative h-[6px] w-full overflow-hidden rounded-full bg-[#E5E5EA]">
            {/* 진행 핸들(0%) */}
            <span className="absolute left-0 top-1/2 block h-[10px] w-[10px] -translate-y-1/2 rounded-full bg-indigo-600" />
          </div>
        </div>
      </section>

      {/* 상품 카드 */}
      {/* 상품 카드 */}
      <section className="mt-3 rounded-[12px] border border-gray-100 bg-white shadow-[0_4px_18px_rgba(0,0,0,0.06)] overflow-hidden">
        <div className="flex">
          {/* 좌측 본문 */}
          {/* 좌측 본문 */}
          <div className="flex flex-1 items-start gap-3 p-[15px]">
            {/* 썸네일: 상자(레이아웃/마스크) 역할만 */}
            <div className="relative h-[56px] w-[56px] flex-shrink-0 overflow-hidden rounded-md border border-gray-200">
              <Image
                src="/placeholder.png"
                alt="상품 이미지"
                fill
                className="object-cover"
              />
            </div>

            {/* 텍스트 컨테이너: 상자(간격/정렬)만 */}
            <div className="min-w-0 flex-1">
              {/* 위치: 아이콘 + 값 (텍스트만) */}
              <div className="flex items-center text-[#111827]">
                {/* 벡터 아이콘(이모지 제거) */}
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="mr-[6px] h-[16px] w-[16px] flex-none"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 21s-6.5-5.33-6.5-10.5A6.5 6.5 0 1 1 18.5 10.5C18.5 15.67 12 21 12 21z" />
                  <circle cx="12" cy="10.5" r="2.5" />
                </svg>

                <span className="text-base font-bold">A-10-35</span>
              </div>

              {/* 상품명 */}
              <p className="mt-[4px] line-clamp-1 text-lg font-medium text-[#111827]">
                노몬드 아이패치
              </p>

              {/* 보조 정보(회색, 작은 폰트) */}
              <p className="mt-[6px] text-sm font-normal not-italic text-left text-gray-600 ">
                현재고 : <span className="font-medium">2000개</span>
              </p>
              <p className="text-sm font-normal not-italic text-left text-gray-600">
                보충재고 위치 :
              </p>
            </div>
          </div>

          {/* 우측 수량 패널 */}
          <div className="flex flex-col w-[108px] border-l border-gray-200">
            {/* 라벨 (상자 역할 + 텍스트 역할 분리) */}
            <div className="w-full bg-[#f7f5ff] py-[6px] text-center">
              <span className="font-pretendard text-sm font-medium text-[#4c34c2] tracking-[-0.5px]">
                피킹수량
              </span>
            </div>

            {/* 값 (순수 텍스트) */}
            <div className="flex-1 flex items-center justify-center">
              <span className="font-pretendard text-xl font-semibold text-[#111827]">
                700개
              </span>
            </div>

            {/* 상태 아이콘 (독립 책임) */}
            <div className="pb-2 flex justify-center">
              <div className="w-6 h-6 flex items-center justify-center rounded-full bg-gray-200">
                <svg
                  className="w-4 h-4 text-white"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 페이지 네비게이션 */}
      <nav className="flex mt-4 items-center gap-3 justify-center">
        {/* 좌측 그룹 */}
        <div className="flex items-center gap-2 justify-self-start">
          <button
            aria-label="처음으로"
            className="flex h-8 w-8 items-center justify-center rounded-md ring-1 ring-gray-200/60 
                     bg-white text-gray-700 transition-colors 
                     disabled:bg-gray-100 disabled:text-gray-300 disabled:cursor-not-allowed"
          >
            <ChevronsLeft className="h-4 w-4" />
          </button>
          <button
            aria-label="이전"
            className="flex h-8 w-8 items-center justify-center rounded-md ring-1 ring-gray-200/60 
                     bg-white text-gray-700 transition-colors 
                     disabled:bg-gray-100 disabled:text-gray-300 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        </div>

        {/* 중앙 페이지 라벨 */}
        <span className="select-none text-center font-pretendard text-[14px] font-semibold text-[#111827]">
          {1} / {17}
        </span>

        {/* 우측 그룹 */}
        <div className="flex items-center gap-2 justify-self-end">
          <button
            aria-label="다음"
            className="flex h-8 w-8 items-center justify-center rounded-md ring-1 ring-gray-200/60 
                     bg-white text-gray-700 transition-colors 
                     disabled:bg-gray-100 disabled:text-gray-300 disabled:cursor-not-allowed"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            aria-label="마지막"
            className="flex h-8 w-8 items-center justify-center rounded-md ring-1 ring-gray-200/60 
                     bg-white text-gray-700 transition-colors 
                     disabled:bg-gray-100 disabled:text-gray-300 disabled:cursor-not-allowed"
          >
            <ChevronsRight className="h-4 w-4" />
          </button>
        </div>
      </nav>
      {/* 박스 그리드 */}
      <section className="mt-3 grid grid-cols-5 gap-3">
        {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => {
          const isOn = selected.includes(n);
          const v = boxData[n];
          return (
            <button
              key={n}
              onClick={() => toggle(n)}
              className={[
                "relative w-[64px] h-[72px]  border bg-white",
                isOn
                  ? "border-2 border-indigo-600 shadow-[0_0_0_2px_rgba(99,102,241,0.18)]"
                  : "border-gray-200",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 flex flex-col",
                "transition-shadow",
              ].join(" ")}
            >
              {/* 상단 바 */}
              <header
                className={[
                  "h-[17px]  #4c34c2 border-solid bg-[#f7f5ff]",
                  isOn ? "bg-indigo-50" : "bg-gray-100/60 flex align-center",
                ].join(" ")}
              >
                {/* 좌상단 번호 라벨 */}
                <span
                  className={[
                    "text-[12px] leading-none text-center",
                    isOn ? "font-semibold text-indigo-600" : "text-gray-400",
                  ].join(" ")}
                >
                  {n}
                </span>
              </header>
              {/* 중앙 수량 */}
              <span
                className={[
                  "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
                  isOn
                    ? "text-[26px] font-extrabold text-indigo-700"
                    : "text-[14px] font-medium text-gray-300",
                ].join(" ")}
              >
                {isOn ? v : ""}
              </span>
            </button>
          );
        })}
      </section>

      {/* 박스정보 요약 */}
      <section className="mt-4 text-[14px]">
        <span className="text-gray-600">박스정보 : </span>
        {selected.map((n, i) => (
          <span key={n} className="text-blue-600">
            {i ? ", " : ""}
            {n}({boxData[n] ?? 0})
          </span>
        ))}
      </section>
    </main>
  );
}
