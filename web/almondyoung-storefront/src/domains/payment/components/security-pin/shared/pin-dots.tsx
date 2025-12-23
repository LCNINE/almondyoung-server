interface PinDotsProps {
  length: number
  filledCount: number
  isShaking?: boolean
}

export default function PinDots({
  length,
  filledCount,
  isShaking,
}: PinDotsProps) {
  return (
    <div className={`mt-6 flex gap-3 ${isShaking ? "animate-shake" : ""}`}>
      {Array.from({ length }).map((_, index) => (
        <div
          key={index}
          className={`h-4 w-4 rounded-full transition-all duration-200 ${
            index < filledCount ? "scale-110 bg-amber-500" : "bg-gray-200"
          }`}
        />
      ))}
    </div>
  )
}
