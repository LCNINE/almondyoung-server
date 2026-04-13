import type {
  SocialProviderDto,
  IdentitiesResponseDto,
} from "../dto/social-identity"

export type SocialProvider = SocialProviderDto

export interface SocialIdentitiesState extends IdentitiesResponseDto {}

export interface SocialAccountDisplay {
  provider: SocialProvider
  linked: boolean
  linkedAt?: string
  email?: string
}
