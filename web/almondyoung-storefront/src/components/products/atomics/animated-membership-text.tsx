"use client"

type AnimatedMembershipTextProps = {
  className?: string
  delay?: number
  duration?: number
  text?: string
}

export const AnimatedMembershipText = ({
  className = "",
  delay = 0,
  duration = 1500,
  text = "멤버십 전용",
}: AnimatedMembershipTextProps) => {
  return (
    <span
      className={`animate-pulse ${className}`}
      style={{ animationDelay: `${delay}ms`, animationDuration: `${duration}ms` }}
    >
      {text}
    </span>
  )
}

export default AnimatedMembershipText
