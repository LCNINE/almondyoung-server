"use server"

import { FilesDto } from "@lib/types/dto/files"
import { api } from "../api"

export const uploadFile = async (formData: FormData): Promise<FilesDto> => {
  const file = formData.get("file") as File
  const contextId = formData.get("contextId") as string

  // Server Action에서 받은 FormData를 Node.js fetch로 직접 forwarding하면
  // 텍스트 필드(contextId 등)가 누락되는 문제가 있어 새 FormData를 명시적으로 구성
  const forwardData = new FormData()
  forwardData.append("file", file, file.name)
  forwardData.append("contextId", contextId)

  const data = await api<FilesDto>("fs", `/files/upload`, {
    method: "POST",
    body: forwardData,
    withAuth: true,
    timeout: 60000,
  })

  return data
}
