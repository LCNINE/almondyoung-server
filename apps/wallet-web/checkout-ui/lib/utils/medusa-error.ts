import { HttpApiError } from "@/checkout-ui/lib/api/api-error"

function toMessage(data: unknown): string {
  const raw =
    typeof data === "string"
      ? data
      : typeof (data as { message?: unknown })?.message === "string"
        ? (data as { message: string }).message
        : ""

  if (!raw) return "요청을 처리하지 못했어요."
  return raw.charAt(0).toUpperCase() + raw.slice(1) + "."
}

export default function medusaError(error: any): never {
  if (error.response) {
    // The request was made and the server responded with a status code
    // that falls out of the range of 2xx
    const u = new URL(error.config.url, error.config.baseURL)
    console.error("Resource:", u.toString())
    console.error("Response data:", error.response.data)
    console.error("Status code:", error.response.status)
    console.error("Headers:", error.response.headers)

    // data 가 객체/배열로 오는 경우가 있어 문자열로 정규화한다 — charAt 이 터지면
    // 원래 Medusa 에러가 통째로 가려진다.
    const message = toMessage(error.response.data)
    throw new HttpApiError(
      message,
      error.response.status,
      error.response.statusText,
      error.data
    )
  } else if (error.request) {
    // The request was made but no response was received
    throw new HttpApiError(
      error.message,
      error.status,
      error.statusText,
      error.data
    )
  } else {
    throw new HttpApiError(
      error.message,
      error.status,
      error.statusText,
      error.data
    )
  }
}
