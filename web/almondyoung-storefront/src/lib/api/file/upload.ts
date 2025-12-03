import { ApiAuthError, HttpApiError } from "@lib/api/api-error"

export const uploadFile = async (formData: FormData) => {
  const response = await fetch(`/api/file/upload`, {
    method: "POST",
    body: formData,
  })

  const data = await response.json()

  if (!response.ok) {
    if (response.status === 401) {
      throw new ApiAuthError(
        "Unauthorized",
        response.status,
        data.message,
        data
      )
    }

    throw new HttpApiError(
      data.message || "Failed to upload file",
      response.status,
      response.statusText,
      data
    )
  }

  return data
}
