"use server"

import { getAuthHeaders } from "@lib/data/cookies"
import { DigitalAssetsResDto } from "@lib/types/dto/digital-asset.dto"
import { revalidatePath } from "next/cache"
import { api } from "../api"
import { HttpApiError } from "../api-error"

export const getDigitalAssets = async ({
  skip,
  take,
}: {
  skip: string
  take: string
}): Promise<DigitalAssetsResDto> => {
  const headers = await getAuthHeaders()

  const result = await api<DigitalAssetsResDto>(
    "medusa",
    `/store/library?skip=${skip}&take=${take}`,
    {
      method: "GET",
      withAuth: true,
      headers: {
        ...headers,
        "Content-Type": "application/json",
        "x-publishable-api-key":
          process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY!,
      },
    }
  )

  return result
}

export const updateDigitalAssetExercise = async (
  assetId: string
): Promise<{ success: boolean; message: string }> => {
  try {
    const headers = await getAuthHeaders()

    await api<void>("medusa", `/store/library/${assetId}/exercise`, {
      method: "POST",
      withAuth: true,
      body: { assetId },
      headers: {
        ...headers,
        "Content-Type": "application/json",
        "x-publishable-api-key":
          process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY!,
      },
    })

    // 페이지 재검증으로 최신 데이터 반영
    revalidatePath("/[countryCode]/mypage/download", "page")

    return {
      success: true,
      message: "라이센스가 성공적으로 사용 처리되었습니다.",
    }
  } catch (error) {
    console.error("Failed to exercise digital asset:", error)
    return {
      success: false,
      message: "라이센스 사용 처리에 실패했습니다. 다시 시도해주세요.",
    }
  }
}

export const downloadDigitalAsset = async (
  assetId: string
): Promise<
  | {
      success: boolean
      message: string
      data: { base64: string; filename: string; mimeType: string }
    }
  | {
      success: false
      message: string
    }
> => {
  try {
    const headers = await getAuthHeaders()

    const baseUrl =
      process.env.USE_RAILWAY_BACKEND === "true"
        ? `${process.env.BACKEND_URL}/medusa`
        : "http://localhost:9000" // 메두사 server PORT

    const response = await fetch(
      `${baseUrl}/store/library/${assetId}/download`,
      {
        method: "GET",
        headers: {
          ...headers,
          "x-publishable-api-key":
            process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY!,
        },
      }
    )

    if (!response.ok) {
      throw new HttpApiError(
        `다운로드 실패: ${response.status}`,
        response.status,
        response.statusText
      )
    }

    const blob = await response.blob()

    // content-disposition 헤더에서 파일명 추출
    const contentDisposition = response.headers.get("content-disposition")
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
          console.warn("Failed to decode filename:", e)
        }
      }
    }

    const arrayBuffer = await blob.arrayBuffer()
    const base64 = Buffer.from(arrayBuffer).toString("base64")
    const mimeType = blob.type || "application/octet-stream"

    return {
      success: true,
      message: "다운로드가 준비되었습니다.",
      data: {
        base64,
        filename,
        mimeType,
      },
    }
  } catch (error: any) {
    console.error("Failed to download digital asset:", error)
    return {
      success: false,
      message:
        error?.message ||
        "라이센스 다운로드에 실패했습니다. 다시 시도해주세요.",
    }
  }
}
