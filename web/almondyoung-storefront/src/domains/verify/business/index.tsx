"use client"
import { useState } from "react"
import { Upload } from "lucide-react"
import { CustomCheckbox } from "@components/common/checkbox"

interface BusinessVerifyFormProps {
  onComplete?: () => void
}

export default function BusinessVerifyForm({
  onComplete,
}: BusinessVerifyFormProps) {
  const [queryStatus, setQueryStatus] = useState<"idle" | "queried">("idle")

  return (
    <div>
      <section className="mx-auto w-full max-w-md flex-1 px-6 py-10">
        {/* INNER: flex-col과 gap으로 내부 콘텐츠를 수직 배치 */}
        <div className="flex flex-col gap-8">
          {/* 2-1. 페이지 제목 */}
          <section className="text-center">
            <h2 className="text-2xl font-bold text-black">
              고객님의 사업자 정보를
              <br />
              확인해드릴게요
            </h2>
          </section>

          {/* 2-2. 입력 폼 (시맨틱 <form> 사용) */}
          <form
            className="flex flex-col gap-6"
            onSubmit={(e) => e.preventDefault()}
          >
            {/* 사업자등록번호 */}
            <div>
              <label
                htmlFor="business-number"
                className="mb-2 block text-sm text-black"
              >
                사업자등록번호
              </label>
              <input
                type="text"
                id="business-number"
                placeholder="123-45-67890"
                className="w-full border-b border-[#8e8e93] px-4 py-3 text-sm text-black placeholder:text-[#8e8e93] focus:border-black focus:outline-none"
              />
            </div>

            {/* 대표자명 */}
            <div>
              <label
                htmlFor="owner-name"
                className="mb-2 block text-sm text-black"
              >
                대표자명
              </label>
              <input
                type="text"
                id="owner-name"
                placeholder="대표자명(사업자등록증 표기)"
                className="w-full border-b border-[#8e8e93] px-4 py-3 text-sm text-black placeholder:text-[#8e8e93] focus:border-black focus:outline-none"
              />
            </div>

            {/* 조회 버튼 */}
            <div className="flex items-center justify-between gap-4 pt-4">
              <span
                className={`rounded-full px-4 py-1.5 text-xs ${
                  queryStatus === "idle"
                    ? "bg-[#e7e7e7] text-[#1c1c1e]"
                    : "bg-blue-100 text-blue-700" // (조회 완료시 예시)
                } `}
              >
                {queryStatus === "idle" ? "미조회" : "조회 완료"}
              </span>
              <button
                type="submit"
                onClick={() => setQueryStatus("queried")}
                className="flex-1 rounded-[5px] bg-[#f29219] px-4 py-2.5 text-xs text-white"
              >
                조회
              </button>
            </div>
          </form>

          {/* 2-3. 파일 첨부 섹션 */}
          <section className="flex flex-col gap-4 border-t pt-8">
            <h3 className="text-center text-[15px] font-medium text-black">
              사업자가 없으시다면 파일로 대신 제출하셔도 돼요
            </h3>

            {/* 파일 첨부 영역 */}
            <div className="flex flex-col gap-3 rounded-[5px] border-[0.5px] border-[#d9d9d9] p-[15px]">
              <CustomCheckbox id="no-business" />
              <label htmlFor="no-business" className="text-sm text-black">
                사업자 정보가 없어요
              </label>
              {/* (파일 첨부 버튼 - shadcn/ui의 Input 사용 권장) */}
              <button
                type="button"
                className="flex w-fit items-center gap-1 rounded-[3px] border border-[#aeaeb2] bg-white px-2.5 py-1.5 text-xs text-[#1e1e1e]"
              >
                <Upload className="h-3 w-3" />
                파일 첨부
              </button>
            </div>
          </section>
          <section className="pt-8">
            <button
              type="button"
              onClick={onComplete}
              disabled={!onComplete}
              className="w-full rounded-[5px] bg-[#ffa500]/40 px-4 py-[13px] text-center text-sm text-white disabled:cursor-not-allowed"
            >
              계좌 등록하기
            </button>
          </section>
        </div>
      </section>
    </div>
  )
}
