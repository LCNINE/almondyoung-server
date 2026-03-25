export function cn(
  ...inputs: Array<
    | string
    | null
    | undefined
    | false
    | Record<string, boolean | null | undefined>
  >
): string {
  const out: string[] = [];

  for (const input of inputs) {
    if (!input) continue;

    if (typeof input === 'string') {
      if (input.trim()) out.push(input.trim());
      continue;
    }

    if (typeof input === 'object') {
      for (const [key, val] of Object.entries(input)) {
        if (val) out.push(key);
      }
    }
  }

  // 중복 제거 (선택 사항)
  return Array.from(new Set(out)).join(' ');
}
