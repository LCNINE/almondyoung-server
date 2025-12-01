"use client"

import { useState } from "react"
import { X } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@components/common/ui/dialog"

interface LoginPasswordModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onComplete: (password: string) => void
  onCancel?: () => void
}

/**
 * 본인확인 모달 컴포넌트
 * 로그인 비밀번호를 입력받습니다.
 */
export function LoginPasswordModal({
  open,
  onOpenChange,
  onComplete,
  onCancel,
}: LoginPasswordModalProps) {
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!password) {
      setError("비밀번호를 입력해주세요.")
      return
    }

    onComplete(password)
  }

  const handleCancel = () => {
    setPassword("")
    setError(null)
    onCancel?.()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle className="sr-only">본인확인</DialogTitle>
        <DialogDescription className="sr-only">
          보안을 위해 로그인 비밀번호를 입력해주세요.
        </DialogDescription>

        <div className="flex flex-col gap-6 p-6">
          {/* 헤더 */}
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-black">본인확인</h2>
            <button
              onClick={handleCancel}
              className="rounded-full p-1 hover:bg-gray-100"
              aria-label="닫기"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* 안내 문구 */}
          <p className="text-sm text-gray-600">
            보안을 위해 로그인 비밀번호를 입력해주세요.
          </p>

          {/* 폼 */}
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label htmlFor="password" className="sr-only">
                로그인 비밀번호
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  setError(null)
                }}
                placeholder="로그인 비밀번호"
                className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                autoFocus
              />
              {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
            </div>

            {/* 버튼 그룹 */}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleCancel}
                className="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-3 text-base font-semibold text-black transition-colors hover:bg-gray-50"
              >
                취소
              </button>
              <button
                type="submit"
                className="flex-1 rounded-lg bg-amber-500 px-4 py-3 text-base font-semibold text-white transition-colors hover:bg-amber-600"
              >
                확인
              </button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  )
}

