import { getAuthHeaders } from "@lib/data/cookies"
import { DigitalAssetsResponse } from "domains/mypage/types/mypage-types"
import { MEDUSA_BASE_URL } from "../api.config"

export const getDigitalAssets = async (
  skip: number = 0,
  take: number = 20
): Promise<DigitalAssetsResponse> => {
  const headers = await getAuthHeaders()

  return await fetch(
    `${MEDUSA_BASE_URL}/store/library?skip=${skip}&take=${take}`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        ...headers,
        "x-publishable-api-key":
          process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY!,
      },
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

  return await fetch(`${MEDUSA_BASE_URL}/store/library/${assetId}/exercise`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
      "x-publishable-api-key": process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY!,
    },
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
    `${MEDUSA_BASE_URL}/store/library/${assetId}/download`,
    {
      method: "GET",
      headers: {
        ...headers,
        "x-publishable-api-key":
          process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY!,
      },
    }
  )

  if (!res.ok) {
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
