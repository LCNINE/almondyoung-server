export function ViewColumns({
  kind,
  value,
  onChange,
}: {
  kind: string
  value: 1 | 2
  onChange: (value: 1 | 2) => void
}) {
  return (
    <div className="flex gap-1">
      {([1, 2] as const).map((count) => (
        <button
          key={count}
          type="button"
          aria-label={`${kind} ${count === 1 ? "한 개씩" : "두 개씩"} 보기`}
          aria-pressed={value === count}
          onClick={() => onChange(count)}
          className={`flex h-6 w-9 items-center justify-center gap-0.5 border ${value === count ? "border-[#bad7f2] bg-[#e7f3ff]" : "border-[#c8c8c8] bg-[#d9d9d9]"}`}
        >
          {Array.from({ length: count }, (_, index) => (
            <span
              key={index}
              className={`${count === 1 ? "w-5" : "w-2"} h-2 border border-white bg-white`}
            />
          ))}
        </button>
      ))}
    </div>
  )
}
