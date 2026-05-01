"use client"

import { cn } from "@/lib/utils"
import { useAnimationControls, AnimatePresence, motion } from "framer-motion"
import { Heart } from "lucide-react"
import { useEffect, useRef } from "react"

interface AnimatedHeartProps {
  isActive: boolean
  className?: string
  inactiveColor?: string
}

export function AnimatedHeart({
  isActive,
  className = "h-7 w-7",
  inactiveColor = "text-gray-300",
}: AnimatedHeartProps) {
  const controls = useAnimationControls()
  const isFirstRender = useRef(true)

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }

    if (isActive) {
      controls.start({
        scale: [1, 1, 1.3, 0.95, 1],
        transition: {
          duration: 0.55,
          times: [0, 0.45, 0.65, 0.8, 1],
          ease: "easeOut",
        },
      })
    } else {
      controls.start({
        scale: [1, 0.9, 1],
        transition: {
          duration: 0.25,
          ease: "easeOut",
        },
      })
    }
  }, [isActive, controls])

  return (
    <motion.div
      className="relative inline-flex items-center justify-center"
      animate={controls}
    >
      <Heart
        className={cn(
          className,
          "transition-colors duration-200",
          isActive ? "text-red-500" : inactiveColor
        )}
      />

      <AnimatePresence>
        {isActive && (
          <motion.div
            className="absolute inset-0 flex items-center justify-center"
            initial={
              isFirstRender.current
                ? false
                : { clipPath: "circle(0% at 50% 50%)" }
            }
            animate={{ clipPath: "circle(75% at 50% 50%)" }}
            exit={{ clipPath: "circle(0% at 50% 50%)" }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          >
            <Heart className={cn(className, "fill-red-500 text-red-500")} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
