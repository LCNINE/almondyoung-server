"use client"

import * as React from "react"

import { registerBusinessAction } from "@/app/actions"
import { Button } from "@/components/ui/button"
import { FieldDescription } from "@/components/ui/field"
import {
  FloatingLabelInput,
  floatingInputClass,
} from "@/components/ui/floating-label-input"
import { Image as ImageIcon, Lock, Upload, X } from "lucide-react"

// input 은 name="file" 로 남아 있어야 FormData 에 실린다.
function FilePicker({
  file,
  onChange,
}: {
  file: File | null
  onChange: (file: File | null) => void
}) {
  const inputRef = React.useRef<HTMLInputElement>(null)

  const clear = () => {
    if (inputRef.current) inputRef.current.value = ""
    onChange(null)
  }

  return (
    <div>
      <input
        ref={inputRef}
        id="file"
        name="file"
        type="file"
        accept="image/jpeg,image/png,image/gif"
        className="sr-only"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />

      {file ? (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-background p-3">
          <ImageIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium">{file.name}</span>
            <span className="text-xs text-muted-foreground">
              {formatFileSize(file.size)}
            </span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={clear}
            aria-label="첨부 파일 삭제"
          >
            <X className="size-4" aria-hidden />
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex w-full flex-col items-center gap-1 rounded-xl border border-dashed border-border bg-background px-4 py-6 transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <Upload className="size-5 text-muted-foreground" aria-hidden />
          <span className="text-sm font-medium">서류 첨부하기</span>
          <span className="text-xs text-muted-foreground">
            JPG · PNG · GIF · 5MB 이하
          </span>
        </button>
      )}
    </div>
  )
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

export function BusinessStep({
  onDone,
  pending,
}: {
  /** 인증 성공 또는 건너뛰기. 어느 쪽이든 가입 플로우를 마무리한다. */
  onDone: () => void
  pending: boolean
}) {
  const [opened, setOpened] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  // 파일을 첨부하면 서버가 번호/대표자명/개업일자를 무시하므로 입력칸도 잠근다.
  const [file, setFile] = React.useState<File | null>(null)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const res = await registerBusinessAction(new FormData(e.currentTarget))
    setSubmitting(false)
    if (res.ok) {
      onDone()
    } else {
      setError(res.error)
    }
  }

  const busy = submitting || pending
  const hasFile = file !== null

  if (!opened) {
    return (
      <div className="flex flex-1 flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h2 className="text-xl font-bold">가입이 완료됐어요</h2>
          <p className="text-sm text-muted-foreground">
            사업자 회원이시라면 지금 인증하고 전용 상품과 가격을 볼 수 있어요.
            <br className="hidden sm:inline" /> 나중에 마이페이지에서 해도
            괜찮아요.
          </p>
        </div>

        <div className="mt-auto flex flex-col gap-2 pt-6">
          <Button
            type="button"
            onClick={() => setOpened(true)}
            disabled={busy}
            className="h-[52px] rounded-xl text-base font-bold"
          >
            사업자 인증하기
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={onDone}
            disabled={busy}
            className="h-[52px] rounded-xl text-base text-muted-foreground"
          >
            {pending ? "이동 중..." : "건너뛰기"}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-1 flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        사업자등록증에 적힌 대로 입력해주세요.
      </p>

      <div className="relative flex flex-col gap-4">
        {hasFile && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-background/70">
            <span className="flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-[13px] font-medium text-background">
              <Lock className="size-3.5" aria-hidden />
              첨부한 서류로 심사해요
            </span>
          </div>
        )}
        <FloatingLabelInput
          id="businessNumber"
          name="businessNumber"
          label="사업자등록번호"
          inputMode="numeric"
          maxLength={12}
          autoComplete="off"
          disabled={hasFile}
        />
        <FloatingLabelInput
          id="representativeName"
          name="representativeName"
          label="대표자명"
          maxLength={20}
          autoComplete="off"
          disabled={hasFile}
        />
        <FloatingLabelInput
          id="startDate"
          name="startDate"
          label="개업일자 (YYYYMMDD)"
          inputMode="numeric"
          maxLength={8}
          autoComplete="off"
          className={floatingInputClass}
          disabled={hasFile}
        />
      </div>
      <FieldDescription className="text-xs">
        {hasFile
          ? "첨부한 서류로 심사하므로 위 정보는 입력하지 않아도 돼요."
          : "세 값이 국세청 기록과 일치해야 인증됩니다."}
      </FieldDescription>

      <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
        <p className="text-sm font-medium">
          사업자등록번호로 인증이 어려우신가요?
        </p>
        <p className="text-xs text-muted-foreground">
          법인사업자이시거나 위 정보로 확인이 안 되면, 사업자등록증·명함 등
          사업자임을 확인할 수 있는 대체 인증수단을 첨부해 주세요. 담당자가 확인 후
          처리해 드려요.
        </p>

        <FilePicker file={file} onChange={setFile} />
        {!hasFile && (
          <p className="text-xs text-muted-foreground">
            파일을 첨부하면 위 입력값 대신 서류로 심사합니다.
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="mt-auto flex flex-col gap-2 pt-6">
        <Button
          type="submit"
          disabled={busy}
          className="h-[52px] rounded-xl text-base font-bold"
        >
          {submitting ? "인증 중..." : "인증하고 시작하기"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={onDone}
          disabled={busy}
          className="h-[52px] rounded-xl text-base text-muted-foreground"
        >
          건너뛰기
        </Button>
      </div>
    </form>
  )
}
