/** 평소 선반이 비어 있는 상품을 적치할 때만 보인다 — 켜 두면 이 선반이 다음 적치 때 미리 채워진다. */
export function RememberUsualToggle({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2 rounded-md border border-gray-200 bg-gray-50 p-2 text-sm text-gray-700">
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        이 선반을 평소 선반으로 정하기
        <span className="block text-xs text-gray-500">
          다음에 이 상품을 넣을 때 이 선반이 먼저 채워져요.
        </span>
      </span>
    </label>
  );
}

export function usualShelfNotice(code: string) {
  return `평소 선반으로 정했어요: ${code}`;
}
