export const getAccessTokenFromCookie = () => {
  if (typeof document === "undefined") return null

  const raw = document.cookie || ""
  if (!raw) return null

  const tokenPair = raw
    .split("; ")
    .find((cookie) => cookie.startsWith("accessToken="))

  if (!tokenPair) return null

  const value = tokenPair.split("=").slice(1).join("=")
  return value ? decodeURIComponent(value) : null
}
