export function formatBirthday(birthday: string): string {
  // "19941024" → "1994-10-24"
  return `${birthday.substring(0, 4)}-${birthday.substring(4, 6)}-${birthday.substring(6, 8)}`
}
