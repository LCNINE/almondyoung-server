"use client"

import { StepTwo } from "@components/shop-survey/components/shop-survey-form/step-two"
import SurveyHeader from "@components/shop-survey/components/surbey-header"
import { PageTitle } from "@components/common/page-title"
import { useState } from "react"
import { Building2, Check, Minus, Plus, Scissors, Users } from "lucide-react"

/**
 * 설정 페이지 클라이언트 컴포넌트
 * StepTwo 컴포넌트를 재사용하여 샵 정보 설정
 */
export function SettingClient() {
  const [values, setValues] = useState({
    isOperating: true,
    yearsOperating: 0,
    shopType: "",
    targetCustomers: [] as string[],
    openDays: [] as string[],
  })

  const handleChange = (field: string, value: any) => {
    setValues((prev) => ({
      ...prev,
      [field]: value,
    }))
  }

  const handleSave = () => {
    // TODO: 저장 API 호출
    console.log("Saving settings:", values)
  }

  return (
    <div className="px-4 py-4 md:px-6">
      <SurveyHeader />

      <div className="flex flex-col gap-10 bg-white p-[15px]">
        <form className="flex flex-col gap-10">
          {/* ---------------------------------------------------------------- */}
          {/* ① 샵 운영 여부 */}
          {/* ---------------------------------------------------------------- */}

          <section className="flex w-full flex-col gap-5">
            <header>
              <h2 className="text-base font-bold text-black">
                샵 운영 여부 <span className="text-red-500">*</span>
              </h2>
            </header>

            {/* 운영 여부 버튼 */}
            <fieldset className="flex gap-2">
              <legend className="sr-only">운영 상태 선택</legend>
              <button
                type="button"
                className="flex items-center gap-2.5 rounded-[10px] bg-amber-500 px-4 py-3.5 text-xs font-bold text-white shadow-[0_4px_4px_rgba(0,0,0,0.1)]"
              >
                <Check className="h-3.5 w-3.5" />샵 운영 중
              </button>
              <button
                type="button"
                className="flex items-center gap-2.5 rounded-[10px] bg-white px-4 py-3.5 text-xs font-normal text-gray-600 shadow-[0_4px_4px_rgba(0,0,0,0.1)] outline-[0.5px] outline-zinc-300"
              >
                예비 원장
              </button>
            </fieldset>

            <p className="text-xs text-black">
              얼마나 운영하셨나요? (운영중인 경우만)
            </p>

            {/* 운영 년차 선택 */}
            <div className="flex items-center justify-start gap-5">
              {/* 수량 조절 컨트롤 */}
              <div
                className="flex items-start justify-start"
                role="group"
                aria-label="년차 선택"
              >
                {/* 감소 버튼 */}
                <button
                  type="button"
                  aria-label="감소"
                  className="relative h-7 w-7"
                >
                  <div className="absolute top-0 left-0 h-7 w-7 outline-1 outline-offset-[-0.50px] outline-zinc-300" />
                  <div className="absolute top-[6px] left-[10px] text-center text-xs leading-4 font-normal text-black">
                    -
                  </div>
                </button>

                {/* 현재 값 표시 */}
                <div className="relative h-7 w-9">
                  <div className="absolute top-0 left-[0.32px] h-7 w-9 outline-1 outline-offset-[-0.50px] outline-zinc-300" />
                  <input
                    type="number"
                    value={3}
                    className="absolute top-[6px] left-[14.32px] w-2.5 [appearance:textfield] border-0 bg-transparent p-0 text-center text-xs leading-4 font-bold text-black outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    aria-label="년차"
                    onChange={(e) => e.target.value}
                  />
                </div>

                {/* 증가 버튼 */}
                <button
                  type="button"
                  aria-label="증가"
                  className="relative h-7 w-7"
                >
                  <div className="absolute top-0 left-[0.32px] h-7 w-7 outline-1 outline-offset-[-0.50px] outline-zinc-300" />
                  <div className="absolute top-[6.28px] left-[9.86px] w-2.5 text-center text-xs leading-4 font-normal text-black">
                    +
                  </div>
                </button>
              </div>

              {/* 라벨 */}
              <span className="text-xs leading-4 font-normal text-black">
                년차
              </span>
            </div>
          </section>

          {/* ---------------------------------------------------------------- */}
          {/* ② 샵 기본 정보 */}
          {/* ---------------------------------------------------------------- */}
          <section className="flex w-[770px] flex-col gap-5">
            <header>
              <h2 className="flex items-center gap-1 text-base font-bold text-black">
                <Building2 className="h-4 w-4 text-amber-500" />샵 기본 정보
              </h2>
            </header>

            <p className="text-xs text-black">매장 규모</p>

            <fieldset className="flex items-center gap-2">
              <legend className="sr-only">매장 규모 선택</legend>

              <button className="flex items-center justify-center gap-2.5 rounded-[10px] bg-amber-500 px-4 py-3.5 text-xs font-bold text-white shadow-[0_4px_4px_rgba(0,0,0,0.1)]">
                1인샵
              </button>
              <button className="flex items-center justify-center gap-2.5 rounded-[10px] bg-white px-4 py-3.5 text-xs text-gray-600 shadow-[0_4px_4px_rgba(0,0,0,0.1)] outline-[0.5px] outline-zinc-300">
                2~3인 소형샵
              </button>
              <button className="shadow-[0_4px_4px_rgba(0,0,0,0.1)]outline-[0.5px] flex items-center justify-center gap-2.5 rounded-[10px] bg-white px-4 py-3.5 text-xs text-gray-600 outline-zinc-300">
                4인 이상 중형/대형샵
              </button>
            </fieldset>
          </section>

          {/* ---------------------------------------------------------------- */}
          {/* ③ 샵 유형 및 시술 종류 */}
          {/* ---------------------------------------------------------------- */}
          <section className="flex w-[770px] flex-col gap-5">
            <header>
              <h2 className="flex items-center gap-1 text-base font-bold text-black">
                <Scissors className="h-4 w-4 text-amber-500" />샵 유형 및 시술
                종류
              </h2>
            </header>

            <p className="text-xs text-black">
              어떤 시술을 제공(또는 준비)하고 계신가요? (다중 선택 가능)
              <span className="ml-1 text-red-500">*</span>
            </p>

            <fieldset className="flex flex-wrap gap-2">
              <legend className="sr-only">시술 종류 선택</legend>
              {[
                "헤어",
                "네일",
                "속눈썹",
                "속눈썹연장",
                "반영구",
                "왁싱",
                "피부미용",
              ].map((label, i) => (
                <button
                  key={label}
                  type="button"
                  className={`flex items-center justify-center gap-2.5 rounded-[10px] px-4 py-3.5 text-xs shadow-[0_4px_4px_rgba(0,0,0,0.1)] ${
                    i === 2
                      ? "bg-amber-500 font-bold text-white"
                      : "bg-white font-normal text-gray-600 outline-[0.5px] outline-zinc-300"
                  }`}
                >
                  {label}
                </button>
              ))}
            </fieldset>
          </section>

          {/* ---------------------------------------------------------------- */}
          {/* ④ 고객층 & 운영 정보 */}
          {/* ---------------------------------------------------------------- */}
          <section className="flex w-full flex-col gap-5">
            <header>
              <h2 className="flex items-center gap-1 text-base font-bold text-black">
                <Users className="h-4 w-4 text-amber-500" />
                고객층 & 운영 정보
              </h2>
            </header>

            <p className="text-xs text-black">
              주요 고객층은 누구인가요? (다중 선택 가능)
            </p>

            <fieldset className="flex flex-wrap gap-2">
              <legend className="sr-only">주요 고객층 선택</legend>
              {["여성", "남성", "10대", "20~30대", "40대 이상", "아동"].map(
                (label) => (
                  <button
                    key={label}
                    type="button"
                    className="flex items-center justify-center gap-2.5 rounded-[10px] bg-white px-4 py-3.5 text-xs text-gray-600 shadow-[0_4px_4px_rgba(0,0,0,0.1)] outline-[0.5px] outline-zinc-300"
                  >
                    {label}
                  </button>
                )
              )}
            </fieldset>

            <p className="text-xs text-black">
              샵 운영 요일 (다중 선택 가능 / 운영 중인 경우만)
            </p>

            <fieldset className="flex flex-wrap gap-2">
              <legend className="sr-only">운영 요일 선택</legend>
              {["월", "화", "수", "목", "금", "토", "일"].map((label) => (
                <button
                  key={label}
                  type="button"
                  className="flex items-center justify-center gap-2.5 rounded-[10px] bg-white px-4 py-3.5 text-xs text-gray-600 shadow-[0_4px_4px_rgba(0,0,0,0.1)] outline-[0.5px] outline-zinc-300"
                >
                  {label}
                </button>
              ))}
            </fieldset>
          </section>
        </form>

        <footer className="flex justify-end gap-2">
          <button
            type="button"
            onClick={handleSave}
            className="rounded-[4px] bg-[#FFA500] px-6 py-3 text-white transition-colors hover:bg-[#FF8C00]"
          >
            저장하기
          </button>
        </footer>
      </div>
    </div>
  )
}
