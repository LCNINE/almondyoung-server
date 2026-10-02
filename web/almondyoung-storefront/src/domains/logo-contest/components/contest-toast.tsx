"use client"

import { toast } from "sonner"

export function showContestToast(title: string, description?: string) {
  toast.custom(
    () => (
      <div role="status" className="w-[min(340px,calc(100vw-32px))] rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
        <p className="text-sm font-medium text-gray-900">{title}</p>
        {description && <p className="mt-1 text-xs text-gray-500">{description}</p>}
      </div>
    ),
    { id: "logo-contest-feedback", duration: 3500 }
  )
}
