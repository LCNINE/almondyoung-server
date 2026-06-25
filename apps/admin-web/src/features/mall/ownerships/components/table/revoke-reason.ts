export function normalizeRevokePromptValue(value: string | null): string | null | undefined {
  if (value === null) {
    return null;
  }

  return value.trim() || undefined;
}
