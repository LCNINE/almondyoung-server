"use server"

import { FilesDto } from "@lib/types/dto/files"
import { api } from "../api"

export const uploadFile = async (formData: FormData): Promise<FilesDto> => {
  const data = await api<FilesDto>("fs", `/files/upload`, {
    method: "POST",
    body: formData,
    withAuth: true,
  })

  return data
}
