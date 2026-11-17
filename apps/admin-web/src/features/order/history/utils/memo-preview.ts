/** 목록 칸에 한 줄로 보일 메모 — 비어 있지 않은 첫 줄. 내용이 없으면 null. */
export function memoPreview(memo: string | null | undefined): string | null {
  const firstLine = memo
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return firstLine ?? null;
}
