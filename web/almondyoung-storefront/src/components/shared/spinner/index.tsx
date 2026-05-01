type SpinnerSize = "sm" | "md" | "lg"
type SpinnerColor = "blue" | "gray" | "white"

export function Spinner({
  size = "md",
  color = "blue",
}: {
  size?: SpinnerSize
  color?: SpinnerColor
}) {
  const sizeClasses = {
    sm: "h-4 w-4 border-2",
    md: "h-8 w-8 border-4",
    lg: "h-12 w-12 border-4",
  }

  const colorClasses = {
    blue: "border-gray-200 border-t-blue-600",
    gray: "border-gray-200 border-t-gray-600",
    white: "border-gray-400 border-t-white",
  }

  return (
    <div
      className={`inline-block animate-spin rounded-full ${sizeClasses[size]} ${colorClasses[color]}`}
      role="status"
      aria-label="loading"
    >
      <span className="sr-only">Loading...</span>
    </div>
  )
}
