"use client";
import { ArrowLeft, ScanLine } from "lucide-react";

// --- InboundItemCard Component ---
// 작은 화면에서 버튼들이 깨지지 않도록 레이아웃을 수정했습니다.
interface InboundItemCardProps {
  code: string;
  name: string;
  brand: string;
  unshipped: number;
  location: string;
  planned: number;
  received: number;
  stock: number;
  status: "pending" | "complete" | "shortage";
  imageUrl: string;
}



function InboundItemCard({
  code,
  name,
  brand,
  unshipped,
  location,
  planned,
  received,
  stock,
  status,
  imageUrl,
}: InboundItemCardProps) {
  return (
    <section className="rounded-[10px] border border-gray-200 bg-white p-3 shadow-sm">
      {/* 상단 정보 */}
      <div className="flex gap-3">
        <img
          src={imageUrl}
          alt={name}
          className="h-[64px] w-[64px] flex-shrink-0 rounded-md border border-gray-200 object-cover"
          onError={(e) => {
            e.currentTarget.src = "https://placehold.co/64x64/f9f9f9/ccc?text=No+Img";
          }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between">
            <p className="text-[14px] font-bold text-gray-900">{code}</p>
            <span
              className={`rounded-[4px] px-[8px] py-[2px] text-[12px] font-medium ${
                status === "pending"
                  ? "bg-gray-100 text-gray-500"
                  : status === "complete"
                  ? "bg-green-50 text-green-600"
                  : "bg-red-50 text-red-500"
              }`}
            >
              {status === "pending"
                ? "입고전"
                : status === "complete"
                ? "입고완료"
                : "수량 부족"}
            </span>
          </div>

          <p className="mt-[3px] truncate text-[14px] font-medium text-[#0369a0]">{name}</p>
          <p className="mt-[2px] text-[12px] text-gray-500">
            {brand} | 미발송: {unshipped}개
          </p>
          <p className="mt-[2px] text-[16px] font-semibold text-gray-900">{location}</p>
        </div>
      </div>

      {/* 수량 정보 */}
      <div className="mt-3 grid grid-cols-3 border-t border-gray-100 text-center text-[13px]">
        <div className="py-2">
          <p className="text-gray-500">입고예정</p>
          <p className="font-semibold text-gray-900">{planned}</p>
        </div>
        <div className="py-2">
          <p className="text-gray-500">입고</p>
          <p
            className={`font-semibold ${
              status === "shortage" ? "text-red-500" : "text-gray-900"
            }`}
          >
            {received}
          </p>
        </div>
        <div className="py-2">
          <p className="text-gray-500">현재고</p>
          <p className="font-semibold text-gray-900">{stock}</p>
        </div>
      </div>

      {/* 액션 영역 (정확히 한 줄로 정렬) */}
      <div className="mt-3 flex items-center gap-2">
        <input
          type="number"
          placeholder="0"
          className="h-[40px] w-[56px] rounded-[6px] border border-gray-300 text-center text-[13px] text-gray-700 placeholder:text-gray-400 focus:outline-none"
        />
        <button className="flex-1 h-[40px] rounded-[6px] border border-gray-300 bg-white text-[13px] font-medium text-gray-700 active:bg-gray-100">
          부분 입고처리
        </button>
        <button
          disabled={status === "complete"}
          className={`h-[40px] flex-1 rounded-[6px] text-[13px] font-semibold text-white transition-colors ${
            status === "complete"
              ? "cursor-not-allowed bg-gray-300 text-gray-500"
              : "bg-[#f29219] hover:bg-[#df7b00]"
          }`}
        >
          수량 일치 입고처리
        </button>
      </div>
    </section>
  );
}


// --- InboundFilterForm Component ---
// 모든 필드를 '레이블-입력창'이 세로로 쌓이는 구조로 변경하여 모바일 가독성을 높였습니다.
function InboundFilterForm() {
  return (
    <div className="space-y-4 border-b bg-white p-4 text-sm">
      {/* 입고 예정일 */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="start-date" className="font-medium text-gray-700">
          입고예정일
        </label>
        <div className="flex items-center gap-2">
          <input
            id="start-date"
            type="date"
            className="h-10 flex-1 rounded-md border border-gray-300 px-3 text-[14px] text-gray-800"
          />
          <span className="flex-shrink-0 text-gray-500">~</span>
          <input
            type="date"
            aria-label="end-date"
            className="h-10 flex-1 rounded-md border border-gray-300 px-3 text-[14px] text-gray-800"
          />
        </div>
      </div>

      {/* 발주처 */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="supplier" className="font-medium text-gray-700">
          발주처
        </label>
        <select
          id="supplier"
          className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-[14px] text-gray-800"
        >
          <option>발주처 전체</option>
        </select>
      </div>

      {/* 바코드 */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="barcode" className="font-medium text-gray-700">
          바코드
        </label>
        <div className="relative flex h-10 w-full items-center">
          <input
            id="barcode"
            type="text"
            placeholder="바코드 입력 또는 스캔"
            className="h-full w-full rounded-md border border-gray-300 bg-yellow-50 py-2 pl-3 pr-10 text-[14px] text-gray-800 placeholder-gray-400 outline-none"
          />
          <ScanLine className="absolute right-3 h-5 w-5 text-gray-500" />
        </div>
      </div>

      {/* 상품명 */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="product-name" className="font-medium text-gray-700">
          상품명
        </label>
        <input
          id="product-name"
          type="text"
          placeholder="상품명 입력"
          className="h-10 w-full rounded-md border border-gray-300 px-3 text-[14px] text-gray-800 placeholder-gray-400"
        />
      </div>

      {/* 검색 버튼 */}
      <div className="pt-2">
        <button className="h-11 w-full rounded-md bg-gray-800 px-6 font-semibold text-white hover:bg-gray-700">
          검색
        </button>
      </div>
    </div>
  );
}

// --- InboundListPage Page ---
export default function InboundListPage() {
  const items = [
    {
      code: "3543243545",
      name: "코디피아 메이크업 아이라이너 펜슬 3종 (컬러:브라운)",
      brand: "르아리컴퍼니",
      unshipped: 2,
      location: "A-10-35",
      planned: 20,
      received: 0,
      stock: 0,
      status: "pending",
      imageUrl: "https://placehold.co/128x128/f29219/white?text=Item-A",
    },
    {
      code: "3543243545",
      name: "코디피아 메이크업 아이라이너 펜슬 3종 (컬러:브라운)",
      brand: "르아리컴퍼니",
      unshipped: 2,
      location: "M-13-15",
      planned: 20,
      received: 20,
      stock: 20,
      status: "complete",
      imageUrl: "https://placehold.co/128x128/4ade80/white?text=Item-B",
    },
    {
      code: "3543243545",
      name: "코디피아 메이크업 아이라이너 펜슬 3종 (컬러:브라운)",
      brand: "르아리컴퍼니",
      unshipped: 2,
      location: "M-13-15",
      planned: 20,
      received: 19,
      stock: 19,
      status: "shortage",
      imageUrl: "https://placehold.co/128x128/f87171/white?text=Item-C",
    },
  ];

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b bg-white px-4 py-3">
        <ArrowLeft className="h-5 w-5 text-gray-700" />
        <h1 className="flex-1 text-center text-base font-semibold">
          입고리스트 (한국)
        </h1>
        <ScanLine className="h-5 w-5 text-gray-500" />
      </header>

      <InboundFilterForm />

      <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-b bg-gray-50 px-4 py-2 text-sm">
        <span>
          오늘 완료된 입고 건 수: <span className="font-semibold">3</span>
        </span>
        <span>
          검색된 입고 건 수: <span className="font-semibold">30</span>건
        </span>
      </div>

      <div className="space-y-3 p-4">
        {items.map((item, idx) => (
          <InboundItemCard
            key={idx}
            {...item}
            status={item.status as "pending" | "complete" | "shortage"}
          />
        ))}
      </div>

      <div className="py-6 text-center text-sm text-gray-400">
        더 이상 아이템이 없습니다.
      </div>
    </main>
  );
}
