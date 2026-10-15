export function formatProductInfoText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/([^\s])[ \t]*([①-⑳])/g, "$1\n$2")
}
