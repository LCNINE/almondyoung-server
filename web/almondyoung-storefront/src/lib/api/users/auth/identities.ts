"use server"

import { api } from "../../api"
import type {
  IdentitiesResponseDto,
  UnlinkResponseDto,
  SocialProviderDto,
} from "@/lib/types/dto/social-identity"
import type { SocialIdentitiesState } from "@/lib/types/ui/social-identity"

export async function getIdentities(): Promise<IdentitiesResponseDto> {
  return api<IdentitiesResponseDto>("users", "/auth/identities", {
    method: "GET",
    withAuth: true,
    next: { tags: ["social-identities"] },
  })
}

export async function getIdentitiesWithFallback(): Promise<SocialIdentitiesState> {
  try {
    return await getIdentities()
  } catch {
    return {
      identities: [],
      hasPassword: true,
      availableProviders: ["kakao", "naver"],
    }
  }
}

export async function unlinkIdentity(
  provider: SocialProviderDto
): Promise<UnlinkResponseDto> {
  return api<UnlinkResponseDto>("users", `/auth/identities/${provider}`, {
    method: "DELETE",
    withAuth: true,
  })
}
