export const LOGO_CONTEST_ENTRY_STATUSES = ['active', 'hidden'] as const;
export type LogoContestEntryStatus =
  (typeof LOGO_CONTEST_ENTRY_STATUSES)[number];

export const LOGO_CONTEST_STATUS_LABELS: Record<
  LogoContestEntryStatus,
  string
> = {
  active: '공개',
  hidden: '숨김',
};

export interface AdminLogoContestEntryDto {
  id: string;
  title: string;
  description: string | null;
  /** 출품자가 보낸 이름을 서버가 가린 값 ('정*식'). 정본은 userId 로 회원 정보를 붙여 본다. */
  authorName: string;
  /** 첫 장이 대표 이미지 */
  mediaFileIds: string[];
  voteCount: number;
  isWinner: boolean;
  createdAt: string;
  userId: string;
  status: LogoContestEntryStatus;
  agreedAt: string;
}

export interface AdminLogoContestEntryListQuery {
  page?: number;
  limit?: number;
  status?: LogoContestEntryStatus;
  sort?: 'popular' | 'latest';
  q?: string;
}

export interface AdminLogoContestEntryListResponse {
  data: AdminLogoContestEntryDto[];
  total: number;
  page: number;
  limit: number;
}

export interface UpdateLogoContestEntryStatusDto {
  status: LogoContestEntryStatus;
}

export interface LogoContestStatusDto {
  startsAt: string;
  endsAt: string;
  isOpen: boolean;
  isClosed: boolean;
}
