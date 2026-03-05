"use client";

import { X } from "lucide-react";

interface ActionModalProps {
  title?: string;
  message: string;
  actionLabel: string;
  actionColor?: "orange" | "red";
  onClose: () => void;
  onAction: () => void;
}
{
  /* 
   <ActionModal
  variant="complete"
  title="피킹리스트 1회차 완료!"
  message="검수 후 포장해주세요."
  actionLabel="검수 발송 메뉴로 이동"
  actionColor="orange"
  onClose={() => setOpen(false)}
  onAction={() => router.push("/inspection")}
/>
*/
  /* 
 <ActionModal
  variant="warning"
  title="아직 작업이 완료되지 않았습니다."
  message="작업창을 닫으시겠습니까?"
  actionLabel="작업창 닫기"
  actionColor="red"
  onClose={() => setOpen(false)}
  onAction={() => closeTask()}
/>
*/
}

interface ActionModalProps {
  variant?: "complete" | "warning"; // complete = 첫 번째, warning = 두 번째
  title?: string;
  message: string;
  actionLabel: string;
  actionColor?: "orange" | "red";
  onClose: () => void;
  onAction: () => void;
}

export function ActionModal({
  variant = "complete",
  title,
  message,
  actionLabel,
  actionColor = "orange",
  onClose,
  onAction,
}: ActionModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="relative w-[360px] rounded-2xl bg-white p-6 shadow-lg">
        {/* 닫기 버튼 */}
        <button
          onClick={onClose}
          aria-label="닫기"
          className="absolute right-4 top-4 text-gray-500 hover:text-gray-700"
        >
          <X className="h-5 w-5" />
        </button>

        {/* 제목 */}
        {title && (
          <p
            className={
              variant === "complete"
                ? "mb-2 text-center text-sm text-gray-600"
                : "mb-2 text-center text-base font-bold text-gray-900"
            }
          >
            {title}
          </p>
        )}

        {/* 메시지 */}
        <p
          className={
            variant === "complete"
              ? "mb-6 text-center text-lg font-bold text-gray-900"
              : "mb-6 text-center text-base text-gray-600"
          }
        >
          {message}
        </p>

        {/* 액션 버튼 */}
        <button
          onClick={onAction}
          className={[
            "w-full rounded-md py-3 text-white font-semibold",
            actionColor === "orange" ? "bg-orange-500 hover:bg-orange-600" : "",
            actionColor === "red" ? "bg-red-500 hover:bg-red-600" : "",
          ].join(" ")}
        >
          {actionLabel}
        </button>
      </div>
    </div>
  );
}
