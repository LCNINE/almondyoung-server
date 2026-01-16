"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { WidgetCard } from "../../shared/widget-card"
import { ReorderContent } from "./reorder-content"
import { ReviewPromptContent } from "./review-prompt-content"
import { StockAlertContent } from "./stock-alert-content"

export function WidgetSection() {
  const [showReorder, setShowReorder] = useState(true)
  const [showStock, setShowStock] = useState(true)
  const [showReview, setShowReview] = useState(true)

  const hasVisibleWidget = showReorder || showStock || showReview

  const widgetVariants = {
    initial: {
      opacity: 0,
      y: 20,
      height: 0,
      scale: 0.95,
    },
    animate: {
      opacity: 1,
      y: 0,
      height: "auto",
      scale: 1,
      transition: {
        type: "spring",
        stiffness: 300,
        damping: 25,
      },
    },
    exit: {
      opacity: 0,
      scale: 0.9,
      height: 0,
      transition: {
        height: { duration: 0.4, ease: [0.4, 0, 0.2, 1] },
        opacity: { duration: 0.2 },
        scale: { duration: 0.3 },
      },
    },
  } as const

  if (!hasVisibleWidget) return null

  return (
    <div className="flex flex-col">
      <p className="mb-4">
        <span className="font-semibold">정중식</span> 원장님, 오늘 필요한 재료,
        빠르게 처리해드릴게요
      </p>

      <AnimatePresence mode="popLayout">
        {showReorder && (
          <motion.div
            key="reorder"
            layout
            variants={widgetVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="mb-4 overflow-hidden"
          >
            <WidgetCard
              title="최근 구매 제품 중 3종, 다시 필요하신가요?"
              onClose={() => setShowReorder(false)}
            >
              <ReorderContent onClose={() => setShowReorder(false)} />
            </WidgetCard>
          </motion.div>
        )}

        {showStock && (
          <motion.div
            key="stock"
            layout
            variants={widgetVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="mb-4 overflow-hidden"
          >
            <WidgetCard
              title="자주 사는 제품 중 품절 임박 제품이 있어요"
              onClose={() => setShowStock(false)}
            >
              <StockAlertContent />
            </WidgetCard>
          </motion.div>
        )}

        {showReview && (
          <motion.div
            key="review"
            layout
            variants={widgetVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="mb-4 overflow-hidden"
          >
            <WidgetCard
              title="지난번 구매하신 제품 어떠셨나요?"
              onClose={() => setShowReview(false)}
            >
              <ReviewPromptContent />
            </WidgetCard>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
