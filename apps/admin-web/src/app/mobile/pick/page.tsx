"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";

export default function PickingListPage() {
  const router = useRouter();
  const [date] = useState("2025-07-08");

  const handleItemClick = (itemId: number) => {
    router.push(`/mobile/pick/details?id=${itemId}`);
  };

  const lists = [
    {
      id: 1,
      status: "피킹 가능",
      issuedAt: "2025/08/30 09:30",
      seller: "엘씨나인",
      worker: "-",
      count: 20,
    },
    {
      id: 2,
      status: "피킹 중",
      issuedAt: "2025/08/30 09:30",
      seller: "엘씨나인",
      worker: "이연정",
      count: 20,
    },
    {
      id: 3,
      status: "피킹 가능",
      issuedAt: "2025/08/30 09:30",
      seller: "3PL",
      worker: "-",
      count: 20,
    },
    {
      id: 4,
      status: "피킹 가능",
      issuedAt: "2025/08/30 09:30",
      seller: "엘씨나인",
      worker: "-",
      count: 20,
    },
    {
      id: 5,
      status: "피킹 가능",
      issuedAt: "2025/08/30 09:30",
      seller: "엘씨나인",
      worker: "-",
      count: 20,
    },
  ];

  return (
    <section className="flex flex-col min-h-screen bg-gray-50">
      {/* Header */}

      <header className="sticky top-0 z-10 flex items-center justify-between bg-white border-b px-4 py-3">
        <button aria-label="뒤로가기">
          <ChevronRight className="rotate-180 w-6 h-6" />
        </button>
        <h1 className="text-lg font-semibold">피킹리스트 목록</h1>
        <div className="w-6" /> {/* placeholder for balance */}
      </header>

      {/* 출고지시일 */}
      <section className="bg-gray-100 px-4 py-3">
        <label className="font-semibold mr-2">출고지시일</label>
        <input
          type="text"
          value={date}
          readOnly
          className="px-3 py-1.5 rounded-lg border bg-white text-sm"
        />
      </section>

      {/* Picking List */}
      <main className="flex-1 overflow-y-auto px-4 py-2 space-y-3">
        {lists.map((item) => (
          <article
            key={item.id}
            className="bg-white rounded-xl shadow-sm p-4 border relative"
          >
            <header className="flex items-center gap-[10px] mb-3">
              <h2 className="font-bold flex items-center gap-1 text-[20px]">
                <span className="inline-block ">📋</span>
                {item.id}회차
              </h2>
              <span
                className={`text-xs px-2 py-1 rounded-md text-[15px]  font-bold ${
                  item.status === "피킹 중"
                    ? "bg-purple-600  text-white"
                    : " text-indigo-600 border border-solid border-indigo-700"
                }`}
              >
                {item.status}
              </span>
            </header>

            <dl className="space-y-1 text-sm">
              <div className="flex">
                <dt className="w-20 text-gray-500">발행일시</dt>
                <dd>{item.issuedAt}</dd>
              </div>
              <div className="flex mt-[8px]">
                <dt className="w-20 text-gray-500">판매처 분류</dt>
                <dd>{item.seller}</dd>
              </div>
              <div className="flex  mt-[8px]">
                <dt className="w-20 text-gray-500">작업자</dt>
                <dd>{item.worker}</dd>
              </div>
              <div className="flex items-center mt-[8px]">
                <dt className="w-20 text-gray-500">송장 개수</dt>
                <dd>
                  <select
                    className="border rounded-md px-2 py-0.5 text-indigo-600 font-semibold"
                    defaultValue={item.count}
                  >
                    <option value={item.count}>{item.count}</option>
                  </select>
                </dd>
              </div>
            </dl>

            <button 
              aria-label="상세 보기" 
              className="absolute top-4 right-3"
              onClick={() => handleItemClick(item.id)}
            >
              <ChevronRight className="w-7 h-7 text-black" />
            </button>
          </article>
        ))}
      </main>


    </section>
  );
}
