"use client";

import { ArrowLeft, ChevronRight } from "lucide-react";

// --- Header Component ---
function Header() {
  return (
    <header className="flex items-center justify-between border-b bg-white p-4">
      <button className="text-gray-600">
        <ArrowLeft size={20} />
      </button>
      <h1 className="text-lg font-semibold">입고 일정</h1>
      <div className="w-5"></div> {/* For alignment */}
    </header>
  );
}

// --- Date Display Component ---
function DateDisplay() {
  return (
    <div className="py-4 text-center">
      <p className="text-lg font-bold">2025-07-15 (화) 오늘</p>
    </div>
  );
}

// --- Summary Card Component ---
function SummaryCard({
  title,
  count,
  dark = false,
}: {
  title: string;
  count: number;
  dark: boolean;
}) {
  const cardClasses = dark
    ? "bg-indigo-900 text-white"
    : "bg-white text-gray-800 border";

  const chevronClasses = dark ? "bg-white/20" : "bg-gray-100";

  return (
    <div
      className={`flex flex-1 items-center justify-between rounded-xl p-4 shadow-sm ${cardClasses}`}
    >
      <div>
        <p className="text-sm">{title}</p>
        <p className="mt-1 text-2xl font-bold">
          {count} <span className="text-base font-normal">건</span>
        </p>
      </div>
      <div
        className={`flex h-8 w-8 items-center justify-center rounded-full ${chevronClasses}`}
      >
        <ChevronRight size={20} />
      </div>
    </div>
  );
}

// --- Status Tab Component ---
function StatusTab({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex-1 rounded-xl border bg-white p-4 text-center shadow-sm">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-800">
        {count} <span className="text-base font-normal">건</span>
      </p>
    </div>
  );
}

// --- Item List Component ---
function ItemList() {
  const items = [
    "젤네일 재료 고급 자개 금박 은박 메탈 글리터 12종",
    "젤네일 재료 고급 자개 금박 은박 메탈 글리터 12종",
    "젤네일 재료 고급 자개 금박 은박 메탈 글리터 12종",
    "젤네일 재료 고급 자개 금박 은박 메탈 글리터 12종",
  ];

  return (
    <div className="rounded-xl border bg-gray-50 p-4">
      {/* List Header */}
      <div className="mb-4 flex items-center gap-4 border-b pb-3">
        <button className="text-sm font-bold text-blue-600 relative after:content-[''] after:absolute after:left-0 after:bottom-[-13px] after:h-[2px] after:w-full after:bg-blue-600">
          리스트 요약
        </button>
        <button className="text-sm text-gray-500">국내</button>
        <button className="text-sm text-gray-500">해외</button>
      </div>

      {/* List Body */}
      <div className="space-y-2">
        {items.map((item, index) => (
          <div
            key={index}
            className="flex items-center gap-3 rounded-md border bg-white p-3"
          >
            <div className="w-1 self-stretch rounded-full bg-blue-500"></div>
            <p className="text-sm text-gray-800">{item}</p>
          </div>
        ))}
      </div>

      {/* List Footer */}
      <div className="mt-4 text-right">
        <p className="text-sm font-semibold text-gray-700">외 60종</p>
      </div>
    </div>
  );
}

// --- Inbound Schedule Page ---
export default function InboundSchedulePage() {
  return (
    <main className="min-h-screen bg-gray-100">
      <Header />
      <div className="p-4">
        <DateDisplay />

        {/* Summary Cards */}
        <div className="flex gap-3">
          <SummaryCard title="(한국) 입고리스트" count={10} dark />
          <SummaryCard title="(해외) 입고리스트" count={50} dark />
        </div>

        {/* Status Tabs */}
        <div className="mt-4 flex gap-3">
          <StatusTab label="입고전" count={60} />
          <StatusTab label="입고완료" count={0} />
          <StatusTab label="부분입고" count={0} />
        </div>

        {/* Item List */}
        <div className="mt-4">
          <ItemList />
        </div>
      </div>
    </main>
  );
}
