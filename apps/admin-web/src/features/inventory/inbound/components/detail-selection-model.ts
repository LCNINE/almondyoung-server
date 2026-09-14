export function selectReceiptById<T extends { id: string }>(
  rows: readonly T[],
  selectedId: string | null
): T | null {
  if (!selectedId) return null;
  return rows.find((row) => row.id === selectedId) ?? null;
}

export function selectArrivalById<T extends { documentId: string }>(
  rows: readonly T[],
  selectedId: string | null
): T | null {
  if (!selectedId) return null;
  return rows.find((row) => row.documentId === selectedId) ?? null;
}
