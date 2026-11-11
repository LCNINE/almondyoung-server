import type { MigrationMeta } from 'drizzle-orm/migrator';

export interface AppliedMigration {
  hash: string;
  created_at: string | number;
}

export interface MigrationContext {
  stage: string;
  deployment: string;
  service: string;
}

// Reviewed 2026-11-11: only display-name parentheses matching option_key become brackets.
// No identifier/schema/stock changes; length is unchanged and already-converted rows do not match.
// Keep the original SQL/history immutable. A changed file or another stage requires a new review.
const reviewedDataMigrations = [
  {
    stage: 'live',
    deployment: 'lcnine-services',
    service: 'core',
    folderMillis: 1794376282138,
    hash: 'ff67f345c15d9dcaefc675bdd4fc714cf9b4de581655f3bfaf0484e617c5a5f4',
  },
];

export class MigrationReviewRequiredError extends Error {
  readonly reason = 'MAINTENANCE_REVIEW_REQUIRED';

  constructor(readonly migrationTimestamp: number) {
    super(`Migration ${migrationTimestamp} needs an explicit maintenance review before deployment`);
  }
}

/** Match the entire recorded prefix, not just the latest timestamp. */
export function pendingMigrations(files: MigrationMeta[], applied: AppliedMigration[]): MigrationMeta[] {
  if (files.some((file, index) => index > 0 && file.folderMillis <= files[index - 1].folderMillis)) {
    throw new Error('Migration journal must have strictly increasing timestamps');
  }

  const history = [...applied].sort((a, b) => Number(a.created_at) - Number(b.created_at));
  for (const [index, row] of history.entries()) {
    const file = files[index];
    if (!file || file.folderMillis !== Number(row.created_at) || file.hash !== row.hash) {
      throw new Error('Migration history differs from the repository; administrator reconciliation is required');
    }
  }

  return files.slice(history.length);
}

/** Additive SQL or an exact, context-scoped reviewed exception. Not a SQL safety proof. */
export function assertAdditiveMigrations(files: MigrationMeta[], context?: MigrationContext): void {
  const unsafe =
    /\b(drop|truncate|delete|update|rename)\b|\balter\s+(?:column\s+)?[^;]*\b(?:type|set\s+not\s+null)\b|\badd\b[^;]*\bnot\s+null\b|\b(?:do|execute|call)\b/i;

  for (const file of files) {
    const reviewed = reviewedDataMigrations.some(
      (entry) =>
        entry.stage === context?.stage &&
        entry.deployment === context?.deployment &&
        entry.service === context?.service &&
        entry.folderMillis === file.folderMillis &&
        entry.hash === file.hash,
    );
    if (reviewed) continue;

    for (const statement of file.sql) {
      // Strip comments, but deliberately retain quoted strings and function bodies.
      // False positives require review; silently missing dynamic SQL is worse.
      const text = statement.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
      if (unsafe.test(text)) {
        throw new MigrationReviewRequiredError(file.folderMillis);
      }
    }
  }
}
