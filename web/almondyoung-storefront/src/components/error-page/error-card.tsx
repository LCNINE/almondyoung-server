"use client"

import { motion } from "framer-motion"

interface ErrorCardProps {
  onRetry: () => void
  onGoHome: () => void
}

export default function ErrorCard({ onRetry, onGoHome }: ErrorCardProps) {
  return (
    <motion.div
      className="pointer-events-none absolute inset-x-0 top-8 z-50 flex justify-center px-4"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="pointer-events-auto rounded-2xl border border-white/20 bg-white/30 px-6 py-5 shadow-lg backdrop-blur-[2px]">
        <p className="mb-4 text-center text-sm text-gray-700">
          페이지를 불러오는 중 문제가 발생했습니다
          <br />
          <span className="text-gray-500">잠시 후 다시 시도해 주세요</span>
        </p>
        <div className="flex justify-center gap-4">
          <button
            className="text-primary text-xs underline-offset-2 transition-colors hover:underline"
            onClick={onGoHome}
          >
            홈으로
          </button>
          <span className="text-gray-300">|</span>
          <button
            className="text-xs text-gray-500 underline-offset-2 transition-colors hover:text-gray-700 hover:underline"
            onClick={onRetry}
          >
            새로고침
          </button>
        </div>
      </div>
    </motion.div>
  )
}
