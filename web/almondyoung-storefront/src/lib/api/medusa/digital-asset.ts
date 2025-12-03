import { getAuthHeaders } from "@lib/data/cookies"
import { DigitalAssetsResponse } from "@lib/types/dto/digital-asset.dto"

export const getDigitalAssets = async (
  skip: number = 0,
  take: number = 20
): Promise<DigitalAssetsResponse> => {
  const headers = await getAuthHeaders()

  return await fetch(
    `${process.env.APP_URL}/api/medusa/digital-assets?skip=${skip}&take=${take}`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      credentials: "include",
    }
  )
    .then(async (res) => {
      const data = await res.json()

      return data
    })
    .catch((error) => {
      console.error(`Failed to fetch digital assets: ${error.toString()}`)
      throw new Error(error.toString())
    })
}

export const updateDigitalAssetExerciseApi = async (
  assetId: string
): Promise<void> => {
  const headers = await getAuthHeaders()

  return await fetch(`${process.env.APP_URL}/api/medusa/digital-assets`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify({ assetId }),
    credentials: "include",
  })
    .then(async (res) => {
      const data = await res.json()

      return data
    })
    .catch((error) => {
      console.error(
        `Failed to update digital asset exercise: ${error.toString()}`
      )
      throw new Error(error.toString())
    })
}

export const downloadDigitalAssetApi = async (
  assetId: string
): Promise<{ blob: Blob; filename: string }> => {
  const headers = await getAuthHeaders()

  const res = await fetch(
    `${process.env.APP_URL}/api/medusa/digital-assets/download/${assetId}`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      credentials: "include",
    }
  )

  if (!res.ok) {
    const errorData = await res.json()

    throw new Error("파일 다운로드 실패")
  }

  const blob = await res.blob()

  const contentDisposition = res.headers.get("content-disposition")
  let filename = "download"

  if (contentDisposition) {
    const filenameMatch = contentDisposition.match(
      /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/
    )
    if (filenameMatch && filenameMatch[1]) {
      filename = filenameMatch[1].replace(/['"]/g, "")
      // URL 인코딩된 한글 파일명 디코딩
      try {
        filename = decodeURIComponent(filename)
      } catch (e) {
        // 디코딩 실패시 원본 사용
        console.warn("Failed to decode filename:", e)
      }
    }
  }

  return { blob, filename }
}
