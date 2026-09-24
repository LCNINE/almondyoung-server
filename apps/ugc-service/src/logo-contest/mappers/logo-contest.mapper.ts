import { AdminLogoContestEntryResponseDto, LogoContestEntryResponseDto } from '../dto/logo-contest.dto';
import { maskName } from './mask-name';
import type { LogoContestEntryWithVotes } from '../types/logo-contest.types';

export class LogoContestMapper {
  static toResponse(entry: LogoContestEntryWithVotes): LogoContestEntryResponseDto {
    return {
      id: entry.id,
      title: entry.title,
      description: entry.description,
      authorName: maskName(entry.authorName),
      mediaFileIds: entry.mediaFileIds,
      voteCount: entry.voteCount,
      isWinner: entry.isWinner,
      createdAt: entry.createdAt.toISOString(),
    };
  }

  static toAdminResponse(entry: LogoContestEntryWithVotes): AdminLogoContestEntryResponseDto {
    return {
      ...this.toResponse(entry),
      userId: entry.userId,
      status: entry.status,
      agreedAt: entry.agreedAt.toISOString(),
    };
  }
}
