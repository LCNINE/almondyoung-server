"use server"

import { revalidateTag } from "next/cache"
import {
  ALMOND_FONTS_TAG,
  type AlmondFontDto,
} from "@/lib/types/dto/almond-template"
import type { AlmondFont } from "@/lib/types/ui/almond-template"
import { api } from "../api"
import { HttpApiError } from "../api-error"

const FONT_CONTEXT_ID = "almond-template-font"

type Rejected = { error: string }

// 서버액션 경계를 넘으면 에러 문구가 가려져서 400·409 는 값으로 돌려준다
async function orRejected<T>(task: () => Promise<T>): Promise<T | Rejected> {
  try {
    return await task()
  } catch (error) {
    if (
      error instanceof HttpApiError &&
      (error.status === 400 || error.status === 409)
    )
      return { error: error.message }
    throw error
  }
}

export const listAlmondFonts = async (): Promise<AlmondFont[]> =>
  await api<AlmondFontDto[]>("ugc", `/almond-fonts`, {
    method: "GET",
    withAuth: false,
    next: { tags: [ALMOND_FONTS_TAG], revalidate: 300 },
  })

// 파일 본문은 서버액션(Lambda 6MB)을 지나지 않고 브라우저가 스토리지로 바로 올린다
export const presignAlmondFont = async (file: {
  fileName: string
  size: number
  mimeType: string
}) =>
  orRejected(() =>
    api<{
      fileId: string
      uploadUrl: string
      headers: Record<string, string>
    }>("fs", `/files/upload/presign`, {
      method: "POST",
      body: { ...file, contextId: FONT_CONTEXT_ID },
      withAuth: true,
    })
  )

export const registerAlmondFont = async (input: {
  fileId: string
  name: string
}) =>
  orRejected(async () => {
    await api("fs", `/files/upload/confirm`, {
      method: "POST",
      body: { fileId: input.fileId },
      withAuth: true,
    })
    const font: AlmondFont = await api<AlmondFontDto>(
      "ugc",
      `/admin/almond-fonts`,
      {
        method: "POST",
        body: { ...input, licenseConfirmed: true },
        withAuth: true,
        timeout: 90000,
      }
    )
    revalidateTag(ALMOND_FONTS_TAG)
    return font
  })

export const deleteAlmondFont = async (id: string): Promise<void> => {
  await api("ugc", `/admin/almond-fonts/${id}`, {
    method: "DELETE",
    withAuth: true,
  })
  revalidateTag(ALMOND_FONTS_TAG)
}
