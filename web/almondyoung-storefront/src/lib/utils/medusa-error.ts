import { HttpApiError } from "@lib/api/api-error"

export default function medusaError(error: any): never {
  if (error.response) {
    // The request was made and the server responded with a status code
    // that falls out of the range of 2xx
    const u = new URL(error.config.url, error.config.baseURL)
    console.error("Resource:", u.toString())
    console.error("Response data:", error.response.data)
    console.error("Status code:", error.response.status)
    console.error("Headers:", error.response.headers)

    // Extracting the error message from the response data
    const message = error.response.data.message || error.response.data

    throw new HttpApiError(
      message.charAt(0).toUpperCase() + message.slice(1) + ".",
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
