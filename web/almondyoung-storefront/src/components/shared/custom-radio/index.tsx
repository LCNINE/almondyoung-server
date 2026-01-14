const CustomRadio = ({
  label,
  name,
  value,
  checked,
  onChange,
}: {
  label: string
  name: string
  value: string
  checked: boolean
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
}) => (
  <label className="flex cursor-pointer items-center space-x-2">
    <input
      type="radio"
      name={name}
      value={value}
      checked={checked}
      onChange={onChange}
      className="peer sr-only"
    />
    <span
      className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${checked ? "border-[#F29219]" : "border-gray-300"}`}
    >
      {checked && (
        <span className="h-2.5 w-2.5 rounded-full bg-[#F29219]"></span>
      )}
    </span>
    <span
      className={`text-sm ${checked ? "font-semibold text-gray-800" : "text-gray-500"}`}
    >
      {label}
    </span>
  </label>
)

export default CustomRadio
