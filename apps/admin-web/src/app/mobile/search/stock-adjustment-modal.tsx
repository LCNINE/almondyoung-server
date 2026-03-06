"use client";

import { Barcode, Search, X, Plus, Minus } from "lucide-react";
import { useState } from "react";

// --- StockAdjustmentModal Component ---
// 새로 추가된 재고 조정 모달 컴포넌트입니다.
// 기존 UI와 일관성을 유지하도록 디자인했습니다.
export function StockAdjustmentModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [quantity, setQuantity] = useState(0);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="w-full max-w-sm rounded-lg bg-white shadow-xl">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b p-4">
          <h2 className="text-lg font-semibold">재고조정</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-800"
          >
            <X size={24} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4">
          {/* Product Info */}
          <div className="flex items-center gap-3">
            <img
              src="https://placehold.co/160x160/cccccc/ffffff?text=Product"
              alt="상품 이미지"
              className="h-14 w-14 flex-shrink-0 rounded-md border object-cover"
            />
            <div>
              <p className="text-sm font-medium text-blue-700">
                코디피아 메이크업 아이라이너 펜슬 3종 (옵션:브라운)
              </p>
            </div>
          </div>

          {/* Current Stock */}
          <div className="mt-4 flex items-center justify-between rounded-md bg-gray-50 px-4 py-3">
            <span className="text-sm font-medium text-gray-700">현재고</span>
            <span className="text-sm font-semibold">20개</span>
          </div>

          {/* Adjust Stock */}
          <div className="mt-4 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">재고조정</span>
            <div className="flex items-center gap-4">
              <button
                onClick={() => setQuantity((q) => q - 1)}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200"
              >
                <Minus size={16} />
              </button>
              <span className="w-10 text-center text-lg font-semibold">
                {quantity}
              </span>
              <button
                onClick={() => setQuantity((q) => q + 1)}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200"
              >
                <Plus size={16} />
              </button>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex gap-2 border-t p-4">
          <button
            onClick={onClose}
            className="h-11 flex-1 rounded-md border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            취소
          </button>
          <button
            onClick={onClose}
            className="h-11 flex-1 rounded-md bg-[#f29219] text-sm font-medium text-white hover:bg-[#DF7B00]"
          >
            재고조정
          </button>
        </div>
      </div>
    </div>
  );
}

// --- InventorySearchForm Component ---
function InventorySearchForm() {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center">
          <label
            htmlFor="warehouse"
            className="w-full sm:w-20 flex-shrink-0 text-sm font-medium text-gray-700 mb-1 sm:mb-0"
          >
            물류처
          </label>
          <select
            id="warehouse"
            className="flex-1 h-10 rounded-md border border-gray-300 px-3 text-sm"
          >
            <option>창고 전체</option>
          </select>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center">
          <label
            htmlFor="barcode-search"
            className="w-full sm:w-20 flex-shrink-0 text-sm font-medium text-gray-700 mb-1 sm:mb-0"
          >
            바코드
          </label>
          <div className="flex flex-1 items-center">
            <input
              id="barcode-search"
              type="text"
              defaultValue="3543243545"
              placeholder="바코드 입력"
              className="flex-1 h-10 rounded-l-md border border-r-0 border-gray-300 bg-yellow-50 px-3 text-sm"
            />
            <button className="flex h-10 w-10 items-center justify-center rounded-r-md border border-gray-300 bg-white">
              <Barcode className="h-5 w-5 text-gray-600" />
            </button>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center">
          <label
            htmlFor="product-name-search"
            className="w-full sm:w-20 flex-shrink-0 text-sm font-medium text-gray-700 mb-1 sm:mb-0"
          >
            상품명
          </label>
          <input
            id="product-name-search"
            type="text"
            placeholder="상품명 입력"
            className="flex-1 h-10 rounded-md border border-gray-300 px-3 text-sm"
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
