export type SocialProviderDto = "kakao" | "naver"

export interface SocialIdentityDto {
  provider: SocialProviderDto
  providerId: string
  linkedAt: string
  email?: string
  name?: string
}

export interface IdentitiesResponseDto {
  identities: SocialIdentityDto[]
  hasPassword: boolean
  availableProviders: SocialProviderDto[]
}

export interface UnlinkResponseDto {
  success: boolean
  message: string
  provider: SocialProviderDto
}
