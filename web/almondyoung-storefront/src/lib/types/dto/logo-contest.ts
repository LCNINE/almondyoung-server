/** revalidate 태그. "use server" 파일은 async export 만 둘 수 있어 여기 둔다. */
export const LOGO_CONTEST_TAG = "logo-contest"

export interface LogoContestEntryDto {
  id: string
  title: string
  description: string | null
  authorName: string
  mediaFileIds: string[]
  voteCount: number
  isWinner: boolean
  createdAt: string
}

export interface LogoContestStatusDto {
  startsAt: string
  endsAt: string
  isOpen: boolean
  isClosed: boolean
}

export interface MyLogoContestStateDto {
  entry: LogoContestEntryDto | null
  votedEntryId: string | null
}

export interface CreateLogoContestEntryDto {
  title: string
  description?: string
  mediaFileIds: string[]
  authorName: string
  agreed: true
}

export type LogoContestSort = "latest" | "popular"
