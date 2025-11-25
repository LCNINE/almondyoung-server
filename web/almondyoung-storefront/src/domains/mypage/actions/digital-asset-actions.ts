"use server"

import {
  downloadDigitalAssetApi,
  updateDigitalAssetExerciseApi,
} from "@lib/api/medusa/digital-asset"
import { revalidatePath } from "next/cache"

// 해당 라이센스 사용 처리 액션
export async function updateDigitalAssetExerciseAction(assetId: string) {
  try {
    await updateDigitalAssetExerciseApi(assetId)

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

// todo: 다운로드 안되는거 해결해야함
export async function downloadDigitalAssetAction(assetId: string) {
  try {
    const { blob, filename } = await downloadDigitalAssetApi(assetId)

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
