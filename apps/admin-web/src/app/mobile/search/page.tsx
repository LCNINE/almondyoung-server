"use client";

import { Barcode, Search } from "lucide-react";
import { useState } from "react";
import { StockAdjustmentModal } from "./stock-adjustment-modal";

// --- InventorySearchForm Component ---
// 기본적으로 가로 레이아웃을 유지하고, 작은 화면('sm' 분기점 미만)에서만 세로로 쌓이도록 수정했습니다.
function InventorySearchForm() {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row ">
          <label
            htmlFor="warehouse"
            className="w-full sm:w-20 flex-shrink-0 text-sm font-medium text-gray-700 mb-1 sm:mb-0 sm:pr-3 sm:py-2"
          >
            물류처
          </label>
          <select
            id="warehouse"
            className="w-full h-10 rounded-md border border-gray-300 px-3 text-sm"
          >
            <option>창고 전체</option>
          </select>
        </div>
        <div className="flex flex-col sm:flex-row">
          <label
            htmlFor="barcode-search"
            className="w-full sm:w-20 flex-shrink-0 text-sm font-medium text-gray-700 mb-1 sm:mb-0 sm:pr-3 sm:py-2"
          >
            바코드
          </label>
          <div className="flex flex-1 items-center">
            <input
              id="barcode-search"
              type="text"
              defaultValue="3543243545"
              placeholder="바코드 입력"
              className="w-full h-10 rounded-l-md border border-r-0 border-gray-300 bg-yellow-50 px-3 text-sm"
            />
            <button className="flex-shrink-0 flex h-10 w-10 items-center justify-center rounded-r-md border border-gray-300 bg-white">
              <Barcode className="h-5 w-5 text-gray-600" />
            </button>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row">
          <label
            htmlFor="product-name-search"
            className="w-full sm:w-20 flex-shrink-0 text-sm font-medium text-gray-700 mb-1 sm:mb-0 sm:pr-3 sm:py-2"
          >
            상품명
          </label>
          <input
            id="product-name-search"
            type="text"
            placeholder="상품명 입력"
            className="w-full h-10 rounded-md border border-gray-300 px-3 text-sm"
          />
        </div>
        <div className="flex justify-end pt-1">
          <button className="h-10 w-full sm:w-auto rounded-md bg-gray-700 px-6 text-sm font-medium text-white flex items-center justify-center gap-2">
            <Search className="h-4 w-4" />
            검색
          </button>
        </div>
      </div>
    </section>
  );
}

// --- InventoryItemCard Component ---
// 버튼 영역이 작은 화면에서 자연스럽게 줄바꿈되도록 flex-wrap을 사용했습니다.
function InventoryItemCard() {
  const [isOpenModal, setIsOpenModal] = useState(false);
  const onOpenModal = () => {
    setIsOpenModal(true);
  };
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="mb-3 text-sm text-gray-600">
        검색된 상품 수 <span className="font-semibold text-gray-800">1건</span>
      </p>

      <div className="flex gap-3">
        <img
          src="https://placehold.co/160x160/cccccc/ffffff?text=Product"
          alt="상품 이미지"
          className="h-20 w-20 flex-shrink-0 rounded-md border border-gray-200 object-cover"
          onError={(e) => {
            e.currentTarget.src = `https://placehold.co/80x80/f9f9f9/ccc?text=No+Img`;
          }}
        />
        <div className="min-w-0 flex flex-col gap-2">
          <p className="text-sm font-semibold text-gray-900">3543243545</p>
          <p className="truncate text-sm font-medium text-blue-700">
            코디피아 메이크업 아이라이너 펜슬 3종 (옵션: 브라운)
          </p>
          <p className="mt-1 text-xs text-gray-500">사입 | 르아리컴퍼니</p>
          <p className="mt-1 text-sm text-gray-700">
            위치{" "}
            <span className="ml-2 rounded bg-gray-100 px-2 py-[1px] text-sm font-mono">
              J-07-36
            </span>
          </p>
          <p className="mt-1 text-sm text-gray-700">
            보충재고 위치{" "}
            <span className="ml-2 rounded bg-gray-100 px-2 py-[1px] text-sm font-mono">
              T-13-36
            </span>
          </p>
          <p className="mt-1 text-sm text-gray-700">
            현재고 <span className="font-semibold text-gray-900">20개</span>
          </p>
          <p className="mt-1 text-sm font-medium text-red-500">
            ★ 에어캡포장 필수
          </p>
        </div>
      </div>
      <StockAdjustmentModal
        isOpen={isOpenModal}
        onClose={() => setIsOpenModal(false)}
      />
      {/* 버튼 영역: flex-wrap으로 공간이 부족할 때 버튼이 아래로 떨어지게 합니다. */}
      <div className="mt-3 flex flex-wrap gap-2">
        {["조정", "입고", "출고", "주의사항 추가"].map((label) => (
          <button
            key={label}
            onClick={onOpenModal}
            className="flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 whitespace-nowrap"
          >
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}

// --- InventorySearchPage Page ---
export default function InventorySearchPage() {
  return (
    <main className="min-h-screen bg-gray-50 p-4">
      <div className="space-y-4">
        <InventorySearchForm />
        <InventoryItemCard />
      </div>
    </main>
  );
}
