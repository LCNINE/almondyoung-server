"use client"

import React, { useState } from "react"
import { useRouter } from "next/navigation"
import { ChevronLeft, ChevronRight, Info } from "lucide-react"
import { cn } from "@lib/utils" // 프로젝트의 cn 유틸리티 경로에 맞게 수정해주세요

// ----------------------------------------------------------------------
// 🧱 Components
// ----------------------------------------------------------------------

// 1. 공통 리스트 아이템 (화살표형)
interface LinkRowProps {
  label: string
  onClick: () => void
}

const LinkRow = ({ label, onClick }: LinkRowProps) => {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-between border-b border-gray-100 px-5 py-5 transition-colors active:bg-gray-50"
    >
      <span className="text-base font-medium text-[#1c1c1e]">{label}</span>
      <ChevronRight className="h-5 w-5 text-gray-400" />
    </button>
  )
}

// 2. 토글 스위치 컴포넌트
interface SwitchProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}

const Switch = ({ checked, onCheckedChange }: SwitchProps) => {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors duration-200 ease-in-out focus:outline-none",
        checked ? "bg-[#f29219]" : "bg-[#e5e5ea]" // 활성화 시 브랜드 컬러, 비활성화 시 회색
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block h-[26px] w-[26px] rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ease-in-out",
          checked ? "translate-x-[22px]" : "translate-x-[2px]"
        )}
      />
    </button>
  )
}

// 3. 안내 모달 컴포넌트
const InfoModal = ({
  isOpen,
  onClose,
}: {
  isOpen: boolean
  onClose: () => void
}) => {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
      {/* 백드롭 */}
      <div
        className="absolute inset-0 bg-black/60 transition-opacity"
        onClick={onClose}
      />

      {/* 모달 본문 */}
      <div className="relative z-10 flex w-full max-w-[320px] flex-col overflow-hidden rounded-[2px] bg-white shadow-lg">
        <div className="flex flex-col gap-4 p-6">
          <h3 className="text-lg font-bold text-[#1c1c1e]">원터치결제란?</h3>
          <ul className="flex flex-col gap-2 text-sm leading-relaxed text-[#1c1c1e]">
            <li className="flex gap-1.5">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-gray-400" />
              <span>
                저장된 결제수단으로 결제 시 비밀번호 입력없이 간편하게 결제하는
                방식입니다.
              </span>
            </li>
            <li className="flex gap-1.5">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-gray-400" />
              <span>
                쿠팡/쿠팡페이의 보안시스템을 통해 안전한 거래임이 확인된
                경우에만 원터치결제가 진행됩니다.
              </span>
            </li>
            <li className="flex gap-1.5">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-gray-400" />
              <span>
                안전한 결제를 위해 추가 확인이 필요한 경우 비밀번호를 요구할 수
                있습니다.
              </span>
            </li>
            <li className="flex gap-1.5">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-gray-400" />
              <span>
                쿠페이를 사용하는 쿠팡의 모든 서비스에 원터치결제가 적용됩니다.
              </span>
            </li>
          </ul>
        </div>

        {/* 확인 버튼 */}
        <div className="border-t border-gray-100 p-4">
          <button
            onClick={onClose}
            className="w-full rounded-[4px] border border-gray-300 bg-white py-3 text-sm font-bold text-[#1c1c1e] active:bg-gray-50"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  )
}

// ----------------------------------------------------------------------
// 🚀 Main Page
// ----------------------------------------------------------------------

export default function SecuritySettingsPage() {
  const router = useRouter()

  // 상태 관리
  const [isOneTouchEnabled, setIsOneTouchEnabled] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)

  return (
    <div className="min-h-screen bg-white font-['Pretendard']">
      {/* Header */}
      <header className="sticky top-0 z-10 flex h-14 items-center gap-2 bg-white px-4">
        <button
          onClick={() => router.back()}
          className="-ml-2 flex h-10 w-10 items-center justify-center rounded-full hover:bg-gray-100"
        >
          <ChevronLeft className="h-6 w-6 text-black" />
        </button>
        <h1 className="text-lg font-bold text-black">
          결제 비밀번호 · 보안 설정
        </h1>
      </header>

      {/* Main Content */}
      <main className="flex flex-col border-t border-gray-100">
        {/* 1. 비밀번호 변경 */}
        <LinkRow
          label="비밀번호 변경"
          onClick={() => router.push("/security/change-password")}
        />

        {/* 2. 비밀번호 초기화 */}
        <LinkRow
          label="비밀번호 초기화"
          onClick={() => router.push("/security/reset-password")}
        />

        {/* 3. 원터치결제 사용 (Toggle Row) */}
        <div className="flex w-full items-center justify-between border-b border-gray-100 px-5 py-5">
          <div className="flex items-center gap-1.5">
            <span className="text-base font-medium text-[#1c1c1e]">
              원터치결제 사용
            </span>
            {/* 정보 아이콘 버튼 */}
            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="text-gray-400 transition-colors hover:text-gray-600"
              aria-label="원터치결제 설명 보기"
            >
              <Info className="h-4 w-4" />
            </button>
          </div>

          {/* 토글 스위치 */}
          <Switch
            checked={isOneTouchEnabled}
            onCheckedChange={setIsOneTouchEnabled}
          />
        </div>
      </main>

      {/* 모달 */}
      <InfoModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </div>
  )
}
