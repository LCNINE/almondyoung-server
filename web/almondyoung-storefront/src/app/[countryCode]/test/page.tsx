"use client"

import React, { useEffect } from "react"

// --- 아이콘 Placeholder (lucide-react 등 라이브러리로 대체) ---
const CalendarIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
    <line x1="16" y1="2" x2="16" y2="6"></line>
    <line x1="8" y1="2" x2="8" y2="6"></line>
    <line x1="3" y1="10" x2="21" y2="10"></line>
  </svg>
)
const SearchIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="11" cy="11" r="8"></circle>
    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
  </svg>
)

// --- 재사용 UI 컴포넌트 ---
// 1. 폼 필드 그룹 (라벨 + 입력 요소)
const FormField = ({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) => (
  <div className="flex flex-col gap-1">
    <label className="text-sm font-semibold text-gray-700">{label}</label>
    {children}
  </div>
)
// 2. 커스텀 라디오 버튼
const CustomRadio = ({
  name,
  value,
  label,
  checked,
  onChange,
}: {
  name: string
  value: string
  label: string
  checked: boolean
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
}) => (
  <label className="flex cursor-pointer items-center gap-1.5">
    <input
      type="radio"
      name={name}
      value={value}
      checked={checked}
      onChange={onChange}
      className="peer sr-only"
    />
    <span className="flex h-4 w-4 items-center justify-center rounded-full border-2 border-gray-300 peer-checked:border-blue-500">
      <span className="hidden h-2 w-2 rounded-full bg-blue-500 peer-checked:block"></span>
    </span>
    <span className="text-sm">{label}</span>
  </label>
)

// =================================================================================================
// 페이지 컴포넌트
// =================================================================================================

function AdvancedSearchFormPage() {
  const statusOptions = [
    "전체",
    "출고지시",
    "출고작업",
    "출고완료",
    "출고 취소",
  ]
  async function fetchData() {
    const Response = await fetch("https://localhost:3000/masters?limit=50")
    const data = await Response.json()

    return data
  }

  useEffect(() => {
    fetchData().then((data) => {
      console.log(data)
    })
  }, [])

  return (
    <main className="bg-white p-4 font-sans">
      <form className="space-y-4 rounded-lg bg-muted p-6 shadow-md">
        {/* --- 상단 필터 그룹 --- */}
        <div className="grid grid-cols-1 items-end gap-4 md:grid-cols-3 lg:grid-cols-6">
          <FormField label="판매처 분류">
            <select className="w-full rounded-md border border-gray-300 bg-white p-2">
              <option>웹사이트</option>
            </select>
          </FormField>
          <FormField label="판매처 전체">
            <select className="w-full rounded-md border border-gray-300 bg-white p-2">
              <option>판매처 전체</option>
            </select>
          </FormField>
          <FormField label="조회기간">
            <div className="flex items-center gap-2">
              <select className="rounded-md border border-gray-300 bg-white p-2">
                <option>출고요청 일</option>
              </select>
              <div className="relative">
                <input
                  type="text"
                  defaultValue="2025-08-05"
                  className="w-full rounded-md border border-gray-300 bg-white p-2 pr-8"
                />
                <span className="absolute top-1/2 right-2 -translate-y-1/2 text-gray-400">
                  <CalendarIcon />
                </span>
              </div>
              <span className="text-gray-400">~</span>
              <div className="relative">
                <input
                  type="text"
                  defaultValue="2025-08-05"
                  className="w-full rounded-md border border-gray-300 bg-white p-2 pr-8"
                />
                <span className="absolute top-1/2 right-2 -translate-y-1/2 text-gray-400">
                  <CalendarIcon />
                </span>
              </div>
            </div>
          </FormField>
          <FormField label="출고방식">
            <select className="w-full rounded-md border border-gray-300 bg-white p-2">
              <option>택배</option>
            </select>
          </FormField>
          <FormField label="출고회차">
            <select className="w-full rounded-md border border-gray-300 bg-white p-2">
              <option>1회차</option>
            </select>
          </FormField>
        </div>

        {/* --- 중간 필터 그룹 --- */}
        <div className="grid grid-cols-1 items-end gap-4 md:grid-cols-3 lg:grid-cols-5">
          <div className="flex gap-2 md:col-span-2 lg:col-span-2">
            <FormField label="조건검색">
              <select className="w-32 rounded-md border border-gray-300 bg-white p-2">
                <option>선택</option>
              </select>
            </FormField>
            <input
              type="text"
              className="w-full self-end rounded-md border border-gray-300 bg-white p-2"
            />
          </div>
          <FormField label="받는분 이름">
            <input
              type="text"
              className="w-full rounded-md border border-gray-300 bg-white p-2"
            />
          </FormField>
          <FormField label="상품 수">
            <div className="flex items-center gap-2">
              <input
                type="number"
                className="w-full rounded-md border border-gray-300 bg-white p-2"
              />
              <span className="text-gray-400">~</span>
              <input
                type="number"
                className="w-full rounded-md border border-gray-300 bg-white p-2"
              />
            </div>
          </FormField>
          <FormField label="진행상태">
            <div className="flex h-10 items-center gap-3 p-2">
              {statusOptions.map((opt) => (
                <label key={opt} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    defaultChecked={opt === "전체"}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  {opt}
                </label>
              ))}
            </div>
          </FormField>
        </div>

        {/* --- 하단 검색 그룹 --- */}
        <div className="grid grid-cols-1 items-end gap-4 md:grid-cols-3">
          <div className="flex items-end gap-4 md:col-span-2">
            <FormField label="상품 지정 검색">
              <div className="flex h-10 items-center gap-3 p-2">
                <CustomRadio
                  name="searchType"
                  value="exact"
                  label="완전일치"
                  checked={true}
                  onChange={() => {}}
                />
                <CustomRadio
                  name="searchType"
                  value="contains"
                  label="포함"
                  checked
                  onChange={() => {}}
                />
              </div>
            </FormField>
            <div className="relative flex-grow">
              <input
                type="text"
                className="w-full rounded-md border border-gray-300 bg-white p-2 pr-10"
              />
              <button
                type="button"
                className="absolute top-1/2 right-2 -translate-y-1/2 text-gray-400"
              >
                <SearchIcon />
              </button>
            </div>
          </div>
        </div>

        {/* --- 액션 버튼 --- */}
        <div className="flex justify-center gap-4 pt-4">
          <button
            type="submit"
            className="rounded-md bg-orange-500 px-10 py-2 font-bold text-white"
          >
            검색
          </button>
          <button
            type="reset"
            className="rounded-md border border-gray-300 bg-white px-10 py-2 font-bold text-gray-700"
          >
            초기화
          </button>
        </div>
      </form>
    </main>
  )
}

export default AdvancedSearchFormPage
