export const getDisplayFilename = (
  url: string,
  maxLength: number = 20
): string => {
  const filename = url.split("/").pop() ?? ""

  if (filename.length <= maxLength) return filename

  const ext = filename.split(".").pop() // 확장자 추출 (jpg)
  const name = filename.slice(0, filename.lastIndexOf(".")) // 확장자 제외한 이름

  const truncatedName = name.slice(0, maxLength - ext!.length - 4) // "...", ".", ext 길이 고려

  return `${truncatedName}...${ext}`
}
