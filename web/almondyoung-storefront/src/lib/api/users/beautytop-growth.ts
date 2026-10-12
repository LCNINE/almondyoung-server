"use server"

import { api } from "../api"
import { ApiAuthError, HttpApiError } from "../api-error"
import type {
  GrowthNoteDto,
  GrowthNoteTargetDto,
  RecordGrowthNoteDto,
  GrowthNotesResultDto,
} from "@/lib/types/dto/beautytop-growth"

async function result(
  task: () => Promise<GrowthNoteDto[]>
): Promise<GrowthNotesResultDto> {
  try {
    return { ok: true, data: await task() }
  } catch (error) {
    if (error instanceof ApiAuthError) throw error
    return {
      ok: false,
      code:
        error instanceof HttpApiError && error.status === 400
          ? "SHOP_CHANGED"
          : "FAILED",
    }
  }
}

export async function getGrowthNotes(
  target: GrowthNoteTargetDto
): Promise<GrowthNoteDto[]> {
  return api<GrowthNoteDto[]>("users", "/beautytop/growth-notes", {
    method: "GET",
    params: { shopKind: target.shopKind, shopId: String(target.shopId) },
    cache: "no-store",
  })
}

export async function recordGrowthNote(
  note: RecordGrowthNoteDto
): Promise<GrowthNotesResultDto> {
  return result(() =>
    api<GrowthNoteDto[]>("users", "/beautytop/growth-notes", {
      method: "POST",
      body: note,
    })
  )
}

export async function removeGrowthNote(
  target: GrowthNoteTargetDto,
  id: string
): Promise<GrowthNotesResultDto> {
  return result(() =>
    api<GrowthNoteDto[]>(
      "users",
      `/beautytop/growth-notes/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
        params: { shopKind: target.shopKind, shopId: String(target.shopId) },
      }
    )
  )
}
