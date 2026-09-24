import type {
  LogoContestEntryDto,
  LogoContestStatusDto,
} from "@/lib/types/dto/logo-contest"

export interface LogoContestEntry extends LogoContestEntryDto {}

export interface LogoContestStatus extends LogoContestStatusDto {}

export const LOGO_CONTEST_MAX_IMAGES = 3
export const LOGO_CONTEST_MIN_IMAGES = 2
export const LOGO_CONTEST_MAX_IMAGE_SIZE_MB = 10
export const LOGO_CONTEST_ACCEPTED_IMAGE_TYPES =
  "image/jpeg,image/png,image/webp"
export const LOGO_CONTEST_TITLE_MAX_LENGTH = 30
export const LOGO_CONTEST_DESCRIPTION_MAX_LENGTH = 500
