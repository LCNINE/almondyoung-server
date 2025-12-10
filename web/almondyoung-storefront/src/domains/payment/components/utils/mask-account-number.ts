// 계좌번호 마스킹
export const maskAccountNumber = (accountNumber: string) => {
  if (accountNumber.length <= 8) return accountNumber
  const start = accountNumber.slice(0, 4)
  const end = accountNumber.slice(-2)
  return `${start}-${"*".repeat(accountNumber.length - 6)}-${end}`
}
