import type { InferSelectModel } from 'drizzle-orm';
import type { logoContestEntries } from '../../db/schema';

export type LogoContestEntryEntity = InferSelectModel<typeof logoContestEntries>;

export type LogoContestEntryWithVotes = LogoContestEntryEntity & {
  voteCount: number;
  mediaFileIds: string[];
};
