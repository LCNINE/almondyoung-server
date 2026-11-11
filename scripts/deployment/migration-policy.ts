import type { MigrationMeta } from 'drizzle-orm/migrator';

export interface AppliedMigration {
  hash: string;
  created_at: string | number;
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

/** Conservative predeploy guard. This supplements SQL review; it is not a SQL safety proof. */
export function assertAdditiveMigrations(files: MigrationMeta[]): void {
  const unsafe =
    /\b(drop|truncate|delete|update|rename)\b|\balter\s+(?:column\s+)?[^;]*\b(?:type|set\s+not\s+null)\b|\badd\b[^;]*\bnot\s+null\b|\b(?:do|execute|call)\b/i;

  for (const file of files) {
    for (const statement of file.sql) {
      // Strip comments, but deliberately retain quoted strings and function bodies.
      // False positives require review; silently missing dynamic SQL is worse.
      const text = statement.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
      if (unsafe.test(text)) {
        throw new Error(`Migration ${file.folderMillis} needs an explicit maintenance review before deployment`);
      }
    }
  }
}
