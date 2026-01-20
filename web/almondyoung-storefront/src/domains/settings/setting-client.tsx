"use client"

import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Building2, Check, Scissors, Users } from "lucide-react"
import SurveyHeader from "@/domains/shop-survey/components/surbey-header"
import { z } from "zod"
import { useEffect, useState } from "react"
import { getShopInfo, updateShopInfo, ServerError } from "@lib/api/users/shop"

export const shopSettingSchema = z.object({
  // 1. 샵 운영 여부 (필수)
  isOperating: z.boolean(),

  // 운영 중일 때만 년차 체크 (선택적 로직은 refine에서 처리하거나 여기서 min 설정)
  yearsOperating: z.number().min(0, "운영 기간을 선택해주세요."),

  // 2. 샵 규모 (필수)
  shopSize: z.enum(["1인샵", "2~3인 소형샵", "4인 이상 중형/대형샵"], {
    error: () => "매장 규모를 선택해주세요.",
  }),

  // 3. 시술 종류 (최소 1개 이상)
  treatments: z
    .array(z.string())
    .min(1, "시술 종류를 최소 1개 이상 선택해주세요."),

  // 4. 고객층 (선택)
  targetCustomers: z.array(z.string()),

  // 5. 운영 요일 (선택)
  openDays: z.array(z.string()),
})

export type ShopSettingFormValues = z.infer<typeof shopSettingSchema>
export function SettingClient() {
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const {
    control,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm<ShopSettingFormValues>({
    resolver: zodResolver(shopSettingSchema),
    defaultValues: {
      isOperating: true,
      yearsOperating: 0,
      shopSize: "1인샵",
      treatments: [],
      targetCustomers: [],
      openDays: [],
    },
  })

  // 조건부 렌더링을 위해 현재 값 구독
  const isOperating = watch("isOperating")

  // 초기 데이터 로드
  useEffect(() => {
    const loadShopInfo = async () => {
      try {
        setIsLoading(true)
        setError(null)
        const shopInfo = await getShopInfo()

        if (!shopInfo) {
          setError("상점 정보가 없습니다. 먼저 상점 정보를 생성해주세요.")
          return
        }

        // 백엔드 응답을 폼 데이터로 매핑
        reset({
          isOperating: shopInfo.isOperating,
          yearsOperating: shopInfo.yearsOperating ?? 0,
          shopSize: "1인샵", // 백엔드에 shopSize가 없으므로 기본값 유지
          treatments: Array.isArray(shopInfo.categories)
            ? shopInfo.categories
            : [],
          targetCustomers: Array.isArray(shopInfo.targetCustomers)
            ? shopInfo.targetCustomers
            : [],
          openDays: Array.isArray(shopInfo.openDays) ? shopInfo.openDays : [],
        })
      } catch (err) {
        console.error("상점 정보 로드 실패:", err)
        setError(
          err instanceof Error
            ? err.message
            : "상점 정보를 불러오는데 실패했습니다"
        )
      } finally {
        setIsLoading(false)
      }
    }

    loadShopInfo()
  }, [reset])

  const onSubmit = async (data: ShopSettingFormValues) => {
    try {
      setIsSubmitting(true)
      setError(null)

      // 폼 데이터를 백엔드 DTO로 변환
      const updateDto = {
        isOperating: data.isOperating,
        yearsOperating: data.yearsOperating,
        categories: data.treatments, // treatments → categories
        targetCustomers: data.targetCustomers,
        openDays: data.openDays,
      }

      await updateShopInfo(updateDto)

      // 성공 메시지 (선택사항)
      alert("상점 정보가 성공적으로 저장되었습니다.")
    } catch (err) {
      console.error("상점 정보 저장 실패:", err)
      if (err instanceof ServerError) {
        // 서버 응답 그대로 활용
        // err.response에 서버 응답 전체가 포함됨
        // err.message에는 표시용 메시지가 포함됨
        setError(err.message)
      } else {
        setError(
          err instanceof Error ? err.message : "상점 정보 저장에 실패했습니다"
        )
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-sm text-gray-600">로딩 중...</p>
      </div>
    )
  }

  return (
    <div className="px-4 py-4 md:px-6">
      <SurveyHeader />

      <div className="flex flex-col gap-10 bg-white p-[15px]">
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="flex flex-col gap-10"
        >
          {/* ---------------------------------------------------------------- */}
          {/* ① 샵 운영 여부 */}
          {/* ---------------------------------------------------------------- */}
          <section className="flex w-full flex-col gap-5">
            <header>
              <h2 className="text-base font-bold text-black">
                샵 운영 여부 <span className="text-red-500">*</span>
              </h2>
            </header>

            {/* Controller: 운영 여부 버튼 */}
            <Controller
              name="isOperating"
              control={control}
              render={({ field: { value, onChange } }) => (
                <fieldset className="flex gap-2">
                  <legend className="sr-only">운영 상태 선택</legend>
                  <button
                    type="button"
                    onClick={() => onChange(true)}
                    className={`flex items-center gap-2.5 rounded-[10px] px-4 py-3.5 text-xs shadow-[0_4px_4px_rgba(0,0,0,0.1)] transition-colors ${
                      value
                        ? "bg-amber-500 font-bold text-white"
                        : "bg-white font-normal text-gray-600 outline-[0.5px] outline-zinc-300"
                    }`}
                  >
                    {value && <Check className="h-3.5 w-3.5" />}샵 운영 중
                  </button>
                  <button
                    type="button"
                    onClick={() => onChange(false)}
                    className={`flex items-center gap-2.5 rounded-[10px] px-4 py-3.5 text-xs shadow-[0_4px_4px_rgba(0,0,0,0.1)] transition-colors ${
                      !value
                        ? "bg-amber-500 font-bold text-white"
                        : "bg-white font-normal text-gray-600 outline-[0.5px] outline-zinc-300"
                    }`}
                  >
                    {!value && <Check className="h-3.5 w-3.5" />}
                    예비 원장
                  </button>
                </fieldset>
              )}
            />

            {/* 운영 기간 (운영 중일 때만 표시) */}
            {isOperating && (
              <>
                <p className="text-xs text-black">얼마나 운영하셨나요?</p>

                <Controller
                  name="yearsOperating"
                  control={control}
                  render={({ field: { value, onChange } }) => (
                    <div className="flex items-center justify-start gap-5">
                      <div
                        className="flex items-start justify-start"
                        role="group"
                      >
                        <button
                          type="button"
                          onClick={() => onChange(Math.max(0, value - 1))}
                          className="relative h-7 w-7 rounded border border-zinc-300 hover:bg-gray-50"
                        >
                          -
                        </button>

                        <div className="relative mx-2 flex h-7 min-w-[36px] items-center justify-center rounded border border-zinc-300 px-2">
                          <span className="text-xs font-bold text-black">
                            {value}
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={() => onChange(value + 1)}
                          className="relative h-7 w-7 rounded border border-zinc-300 hover:bg-gray-50"
                        >
                          +
                        </button>
                      </div>
                      <span className="text-xs font-normal text-black">
                        년차
                      </span>
                    </div>
                  )}
                />
              </>
            )}
          </section>

          {/* ---------------------------------------------------------------- */}
          {/* ② 샵 기본 정보 (규모) */}
          {/* ---------------------------------------------------------------- */}
          <section className="flex w-full flex-col gap-5 md:w-[770px]">
            <header>
              <h2 className="flex items-center gap-1 text-base font-bold text-black">
                <Building2 className="h-4 w-4 text-amber-500" />샵 기본 정보
                <span className="text-red-500">*</span>
              </h2>
            </header>

            <p className="text-xs text-black">매장 규모</p>

            <Controller
              name="shopSize"
              control={control}
              render={({ field: { value, onChange } }) => (
                <fieldset className="flex flex-wrap gap-2">
                  {["1인샵", "2~3인 소형샵", "4인 이상 중형/대형샵"].map(
                    (size) => (
                      <button
                        key={size}
                        type="button"
                        onClick={() => onChange(size)}
                        className={`flex items-center justify-center gap-2.5 rounded-[10px] px-4 py-3.5 text-xs shadow-[0_4px_4px_rgba(0,0,0,0.1)] transition-colors ${
                          value === size
                            ? "bg-amber-500 font-bold text-white"
                            : "bg-white font-normal text-gray-600 outline-[0.5px] outline-zinc-300 hover:bg-gray-50"
                        }`}
                      >
                        {size}
                      </button>
                    )
                  )}
                </fieldset>
              )}
            />
            {errors.shopSize && (
              <p className="text-xs text-red-500">{errors.shopSize.message}</p>
            )}
          </section>

          {/* ---------------------------------------------------------------- */}
          {/* ③ 시술 종류 (다중 선택) */}
          {/* ---------------------------------------------------------------- */}
          <section className="flex w-full flex-col gap-5 md:w-[770px]">
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

            <Controller
              name="treatments"
              control={control}
              render={({ field: { value, onChange } }) => (
                <fieldset className="flex flex-wrap gap-2">
                  {[
                    "헤어",
                    "네일",
                    "속눈썹",
                    "속눈썹연장",
                    "반영구",
                    "왁싱",
                    "피부미용",
                  ].map((item) => {
                    const isSelected = value.includes(item)
                    return (
                      <button
                        key={item}
                        type="button"
                        onClick={() => {
                          const newValue = isSelected
                            ? value.filter((v) => v !== item)
                            : [...value, item]
                          onChange(newValue)
                        }}
                        className={`flex items-center justify-center gap-2.5 rounded-[10px] px-4 py-3.5 text-xs shadow-[0_4px_4px_rgba(0,0,0,0.1)] transition-colors ${
                          isSelected
                            ? "bg-amber-500 font-bold text-white"
                            : "bg-white font-normal text-gray-600 outline-[0.5px] outline-zinc-300 hover:bg-gray-50"
                        }`}
                      >
                        {item}
                      </button>
                    )
                  })}
                </fieldset>
              )}
            />
            {errors.treatments && (
              <p className="text-xs text-red-500">
                {errors.treatments.message}
              </p>
            )}
          </section>

          {/* ---------------------------------------------------------------- */}
          {/* ④ 고객층 & 운영 요일 */}
          {/* ---------------------------------------------------------------- */}
          <section className="flex w-full flex-col gap-5">
            <header>
              <h2 className="flex items-center gap-1 text-base font-bold text-black">
                <Users className="h-4 w-4 text-amber-500" />
                고객층 & 운영 정보
              </h2>
            </header>

            {/* 고객층 */}
            <p className="text-xs text-black">
              주요 고객층은 누구인가요? (다중 선택)
            </p>
            <Controller
              name="targetCustomers"
              control={control}
              render={({ field: { value, onChange } }) => (
                <fieldset className="flex flex-wrap gap-2">
                  {["여성", "남성", "10대", "20~30대", "40대 이상", "아동"].map(
                    (target) => {
                      const isSelected = value.includes(target)
                      return (
                        <button
                          key={target}
                          type="button"
                          onClick={() => {
                            const newValue = isSelected
                              ? value.filter((v) => v !== target)
                              : [...value, target]
                            onChange(newValue)
                          }}
                          className={`flex items-center justify-center gap-2.5 rounded-[10px] px-4 py-3.5 text-xs shadow-[0_4px_4px_rgba(0,0,0,0.1)] transition-colors ${
                            isSelected
                              ? "bg-amber-500 font-bold text-white"
                              : "bg-white font-normal text-gray-600 outline-[0.5px] outline-zinc-300"
                          }`}
                        >
                          {target}
                        </button>
                      )
                    }
                  )}
                </fieldset>
              )}
            />

            {/* 운영 요일 */}
            <p className="text-xs text-black">샵 운영 요일 (다중 선택)</p>
            <Controller
              name="openDays"
              control={control}
              render={({ field: { value, onChange } }) => (
                <fieldset className="flex flex-wrap gap-2">
                  {["월", "화", "수", "목", "금", "토", "일"].map((day) => {
                    const isSelected = value.includes(day)
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => {
                          const newValue = isSelected
                            ? value.filter((v) => v !== day)
                            : [...value, day]
                          onChange(newValue)
                        }}
                        className={`flex items-center justify-center gap-2.5 rounded-[10px] px-4 py-3.5 text-xs shadow-[0_4px_4px_rgba(0,0,0,0.1)] transition-colors ${
                          isSelected
                            ? "bg-amber-500 font-bold text-white"
                            : "bg-white font-normal text-gray-600 outline-[0.5px] outline-zinc-300"
                        }`}
                      >
                        {day}
                      </button>
                    )
                  })}
                </fieldset>
              )}
            />
          </section>

          {error && (
            <div className="rounded bg-red-50 p-3 text-sm text-red-600">
              {error}
            </div>
          )}

          <footer className="flex justify-end gap-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-[4px] bg-[#FFA500] px-6 py-3 text-white transition-colors hover:bg-[#FF8C00] disabled:bg-gray-300"
            >
              {isSubmitting ? "저장 중..." : "저장하기"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}
