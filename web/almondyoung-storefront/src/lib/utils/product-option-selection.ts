export function normalizeOptionText(value?: string): string {
  if (!value) return ""
  return value.normalize("NFC").replace(/\s+/g, " ").trim()
}

export function buildOptionSelectionKey(
  selection: Record<string, string>,
  optionOrder: string[]
): string | undefined {
  if (optionOrder.length === 0) return undefined

  const parts = optionOrder.map((label) => {
    const normalizedLabel = normalizeOptionText(label)
    const normalizedValue = normalizeOptionText(selection[label])

    if (!normalizedLabel || !normalizedValue) {
      return ""
    }

    return `${normalizedLabel}=${normalizedValue}`
  })

  if (parts.some((part) => !part)) return undefined
  return parts.join("|")
}
