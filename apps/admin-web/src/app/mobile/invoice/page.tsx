"use client";

import { ArrowLeft, ScanLine, X } from "lucide-react";

// 송장 상태 카드
function InvoiceStatusCard({ status }: { status: "complete" | "ready" }) {
  const isComplete = status === "complete";

  return (
    <section className="rounded-lg bg-white p-4 shadow-sm ">
      <div className="flex items-center gap-2 text-sm">
        <span className="font-semibold">46854653212</span>
        <span
          className={`px-2 py-[2px] rounded-md text-xs font-medium ${
            isComplete
              ? "bg-green-50 text-green-600"
              : "bg-blue-50 text-blue-600"
          }`}
        >
          {isComplete ? "완료" : "준비"}
        </span>
        <span className="text-gray-500">피킹 리스트 1회차 - 7</span>
      </div>

      <p className="mt-2 font-semibold">
        강은혜 <span className="text-gray-700">( 금액 : 63,700 원 )</span>
      </p>
      <p className="mt-1 text-sm text-gray-600">
        주소: 서울특별시 광진구 뚝섬로54길 10-5 (자양동) 1층 터치브로우 (자양동
        636-20)
      </p>
      <p className="text-sm text-gray-600">
        hp:010-4187-6544 tel:010-4187-6544
      </p>

      {/* 버튼 */}
      <div className="mt-3 flex gap-2">
        <button
          disabled={isComplete}
          className={`rounded-md px-4 py-2 text-sm font-semibold ${
            isComplete
              ? "bg-gray-100 text-gray-400 cursor-not-allowed"
              : "bg-red-500 text-white hover:bg-red-600"
          }`}
        >
          강제출고
        </button>
        <button className="flex-1 rounded-md border border-gray-300 py-2 text-sm font-semibold text-gray-700">
          출고 취소
        </button>
      </div>
    </section>
  );
}

// 주문 아이템 카드
function OrderItemCard({
  name,
  code,
  location,
  orderQty,
  scanQty,
  requiresSpecialPack,
  
  imageUrl,
}: {
  name: string;
  code: string;
  location: string;
  orderQty: number;
  scanQty: number;
  requiresSpecialPack?: boolean;
  imageUrl: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-md  p-3">
      {/* 이미지 */}
      <img
        src={imageUrl}
        alt={name}
        className="h-14 w-14 rounded-md border border-gray-200 object-cover"
      />

      {/* 텍스트 */}
      <div className="flex-1 min-w-0">
        <p className="font-semibold">{name}</p>
        <div className="mt-1 flex items-center gap-2 text-sm text-gray-500">
          <span>{code}</span>
          <span className="rounded  px-2 py-[2px] text-xs">
            {location}
          </span>
        </div>
        {requiresSpecialPack && (
          <p className="mt-1 text-xs text-red-500">★에어캡포장 필수</p>
        )}
      </div>

      {/* 수량 */}
      <div className="flex flex-col items-end gap-2">
        <span className="rounded-md  w-[70px] py-2 text-sm font-bold text-red-500 text-center border #d9d9d9 border-solid bg-[#fff]">
          주문 {orderQty}
        </span>
        <span
          className={`rounded-md w-[70px] py-2 text-sm font-bold text-center  border #d9d9d9 border-solid bg-[#fff]
           text-blue-500
          }`}
        >
          스캔 {scanQty}
        </span>
      </div>
    </div>
  );
}

interface BarcodeScannerInputProps {
  value?: string;
  onScan: () => void;
  onClear: () => void;
}

function BarcodeScannerInput({
  value,
  onScan,
  onClear,
}: BarcodeScannerInputProps) {
  return (
    <div className="mx-4 mt-3 flex h-12 items-center justify-between rounded-md border border-gray-300 bg-gray-50 px-3">
      {/* 스캔 버튼 */}
      <button
        onClick={onScan}
        aria-label="스캔 시작"
        className="flex items-center justify-center"
      >
        <ScanLine className="h-5 w-5 text-gray-500" />
      </button>

      {/* 텍스트 영역 */}
      <span
        className={`flex-1 px-3 text-center text-sm ${
          value ? "text-gray-900" : "text-gray-400"
        }`}
      >
        {value || "송장 / 바코드 스캔"}
      </span>

      {/* Clear 버튼 */}
      {value && (
        <button
          onClick={onClear}
          aria-label="입력 지우기"
          className="flex items-center justify-center"
        >
          <X className="h-5 w-5 text-gray-500" />
        </button>
      )}
    </div>
  );
}

// 페이지 전체
export default function InspectionShipmentPage() {
  const status = "ready" as "complete" | "ready";
  return (
    <main className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <header className="flex items-center gap-3 border-b bg-white px-4 py-3">
        <ArrowLeft className="h-5 w-5 text-gray-700" />
        <h1 className="flex-1 text-center font-semibold">검수 발송</h1>
        <X className="h-5 w-5 text-transparent" />
      </header>

      {/* 바코드 스캔 영역 */}
      <BarcodeScannerInput value={""} onScan={() => {}} onClear={() => {}} />

      {/* 송장 카드 */}
      <div className="mx-4 mt-3">
        <InvoiceStatusCard status={status} />
      </div>

      {/* 상품 리스트 */}
      <div className="mt-4 space-y-3  p-4">
        <OrderItemCard
          name="노몬드 아이패치"
          code="11137220000"
          location="J-02-06"
          orderQty={40}
          scanQty={status === "complete" ? 20 : 0}
          requiresSpecialPack
          imageUrl="/placeholder.png"
        />
        <OrderItemCard
          name="노몬드 속눈썹 펌제 점도조절 파우더 1.7g"
          code="11137220000"
          location="J-02-06"
          orderQty={10}
          scanQty={status === "complete" ? 20 : 0}
          requiresSpecialPack
          imageUrl="/placeholder.png"
        />
        <OrderItemCard
          name="노몬드 네일 폴리쉬 리무버 1L"
          code="11137220000"
          location="J-02-06"
          orderQty={1}
          scanQty={status === "complete" ? 20 : 0}
          requiresSpecialPack
          imageUrl="/placeholder.png"
        />
      </div>
    </main>
  );
}
