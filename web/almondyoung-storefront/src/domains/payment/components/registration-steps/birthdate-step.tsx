"use client"

import { Spinner } from "@components/common/spinner"
import { Button } from "@components/common/ui/button"
import { zodResolver } from "@hookform/resolvers/zod"
import { updateProfile } from "@lib/api/users/profile/client"

import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { useForm } from "react-hook-form"
import Picker from "react-mobile-picker"
import { toast } from "sonner"
import { z } from "zod"

const formSchema = z.object({
  year: z.string().min(1, "년도를 선택해주세요"),
  month: z.string().min(1, "월을 선택해주세요"),
  day: z.string().min(1, "일을 선택해주세요"),
})

type FormData = z.infer<typeof formSchema>

// 사용자 프로필에 생년월일이 없으면 입력하는 단계 컴포넌트
export default function BirthdateStep({
  status,
  onComplete,
}: {
  status: "verified" | "none"
  onComplete: () => void
}) {
  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    mode: "onChange",
    defaultValues: {
      year: "1990",
      month: "05",
      day: "05",
    },
  })

  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const currentYear = new Date().getFullYear()

  const selections = {
    year: Array.from({ length: 100 }, (_, i) => String(currentYear - i)),
    month: Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0")),
    day: Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0")),
  }

  const handleSubmit = async (data: FormData) => {
    const birthDate = `${data.year}-${data.month}-${data.day}`

    startTransition(async () => {
      try {
        await updateProfile({ birthDate })
        router.refresh() // currentMe 데이터 최신화 하기 위해서
        onComplete() // 다음 단계로 이동
      } catch (error) {
        console.error("Failed to update profile:", error)
        toast.error(
          "생년월일 업데이트에 실패했습니다. 잠시 후 다시 시도해주세요"
        )
      }
    })
  }

  return (
    <form
      className="flex flex-col items-center py-6"
      onSubmit={form.handleSubmit(handleSubmit)}
    >
      <div className="mb-4 flex flex-col items-center justify-center">
        <h2 className="mb-2 text-2xl font-semibold text-gray-800">
          생년월일 입력
        </h2>
        <p className="text-sm text-gray-600">
          회원님의 생년월일을 선택해주세요
        </p>
      </div>

      <div className="relative w-full max-w-xs rounded-lg p-4">
        <div className="pointer-events-none absolute inset-x-0 top-1/2 h-10 -translate-y-1/2 rounded-lg bg-amber-50" />

        <div
          className={`relative transition-all duration-200 ${
            isPending ? "pointer-events-none opacity-50 blur-[1px]" : ""
          }`}
        >
          <Picker
            value={form.watch()}
            onChange={(value) => {
              if (isPending) return // 실제로 비활성화
              form.setValue("year", value.year)
              form.setValue("month", value.month)
              form.setValue("day", value.day)
            }}
            wheelMode="natural"
            height={180}
          >
            <Picker.Column name="year">
              {selections.year.map((year) => (
                <Picker.Item key={year} value={year}>
                  {({ selected }) => (
                    <span
                      className={
                        selected
                          ? "scale-110 font-bold text-amber-600"
                          : "scale-90 text-gray-400"
                      }
                    >
                      {year}년
                    </span>
                  )}
                </Picker.Item>
              ))}
            </Picker.Column>

            <Picker.Column name="month">
              {selections.month.map((month) => (
                <Picker.Item key={month} value={month}>
                  {({ selected }) => (
                    <span
                      className={
                        selected
                          ? "scale-110 font-bold text-amber-600"
                          : "scale-90 text-gray-400"
                      }
                    >
                      {month}월
                    </span>
                  )}
                </Picker.Item>
              ))}
            </Picker.Column>

            <Picker.Column name="day">
              {selections.day.map((day) => (
                <Picker.Item key={day} value={day}>
                  {({ selected }) => (
                    <span
                      className={
                        selected
                          ? "scale-110 font-bold text-amber-600"
                          : "scale-90 text-gray-400"
                      }
                    >
                      {day}일
                    </span>
                  )}
                </Picker.Item>
              ))}
            </Picker.Column>
          </Picker>
        </div>
      </div>

      {/* 도움말 텍스트 */}
      <div className="my-4 text-center text-sm text-gray-500">
        💡 위아래로 스크롤하여 날짜를 선택하세요
      </div>

      <Button
        type="submit"
        className="w-full cursor-pointer bg-amber-500"
        disabled={isPending}
      >
        {isPending ? <Spinner size="sm" color="white" /> : "다음 단계"}
      </Button>
    </form>
  )
}
