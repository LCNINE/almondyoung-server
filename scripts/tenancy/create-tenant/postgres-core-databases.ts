import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type postgres from 'postgres';
import { buildCoreSeedSteps } from '../../seeding/lib/core-seed-steps';
import type { CoreDatabases } from './steps';

/**
 * core 테넌트 DB 의 어댑터 — 로컬 postgres 와 라이브 RDS(sst shell + 터널)가 같은 SQL 을 쓴다. 다른 것은 접속뿐이다
 * (로컬 `scripts/local/create-tenant/local-ports.ts`, 라이브 `./live/live-ports.ts`).
 */
const REPO = join(__dirname, '..', '..', '..');

const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;
function ident(db: string): string {
  if (!IDENT.test(db)) throw new Error(`DB 이름이 식별자 규칙 밖이다: ${db}`);
  return `"${db}"`;
}

export class PostgresCoreDatabases implements CoreDatabases {
  constructor(
    private readonly conn: {
      /** drizzle-kit·시드 스텝이 받는 주소 */
      url: (db: string) => string;
      /** postgres.js 접속 하나(max 1) */
      connect: (db: string) => postgres.Sql;
    },
  ) {}

  private url(db: string) {
    return this.conn.url(db);
  }

  private async withSql<T>(db: string, fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
    const sql = this.conn.connect(db);
    try {
      return await fn(sql);
    } finally {
      await sql.end({ timeout: 5 });
    }
  }

  async exists(db: string) {
    const rows = await this.withSql('postgres', (sql) => sql`SELECT 1 FROM pg_database WHERE datname = ${db}`);
    return rows.length > 0;
  }

  async create(db: string) {
    await this.withSql('postgres', (sql) => sql.unsafe(`CREATE DATABASE ${ident(db)}`));
  }

  async drop(db: string) {
    // 목록에 넣기 전이라 이 DB 에 붙은 앱이 없어야 하지만, 남은 세션(이 스크립트의 시드 등)이 있으면 끊고 지운다.
    await this.withSql('postgres', (sql) => sql.unsafe(`DROP DATABASE IF EXISTS ${ident(db)} WITH (FORCE)`));
  }

  async migrate(db: string) {
    // migrate-all.sh·db:migrate 와 같은 방식 — DATABASE_URL 을 명시 주입해 .env 가 어디를 가리키든 그 DB 만 건드린다.
    execFileSync('npx', ['drizzle-kit', 'migrate', '--config', 'apps/core/drizzle.config.ts'], {
      cwd: REPO,
      env: { ...process.env, DATABASE_URL: this.url(db) },
      stdio: ['ignore', 'ignore', 'pipe'],
      timeout: 600_000,
    });
  }

  async appliedMigrations(db: string) {
    return this.withSql(db, async (sql) => {
      const [t] = await sql`SELECT to_regclass('drizzle.__drizzle_migrations') AS t`;
      if (!t?.t) return [];
      const rows = await sql`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id`;
      return rows.map((r) => String(r.hash));
    });
  }

  repoMigrationCount() {
    const journal = JSON.parse(readFileSync(join(REPO, 'apps/core/drizzle/meta/_journal.json'), 'utf8')) as {
      entries: unknown[];
    };
    return journal.entries.length;
  }

  private async withSeedSteps<T>(db: string, fn: (steps: ReturnType<typeof buildCoreSeedSteps>) => Promise<T>) {
    // 테넌트 1 이 아닌 core DB — «모든 테넌트» 갈래만(창고·자사몰 없음). db:seed:ref --tenant 와 같은 스텝.
    const steps = buildCoreSeedSteps(this.url(db), { tenantOneData: false });
    try {
      return await fn(steps);
    } finally {
      await Promise.all(steps.map((s) => s.dispose()));
    }
  }

  async allTenantsSeedDone(db: string) {
    if (!(await this.exists(db))) return false;
    return this.withSeedSteps(db, async (steps) => {
      for (const s of steps) if (!(await s.check()).isFullySeeded) return false;
      return steps.length > 0;
    });
  }

  async seedAllTenants(db: string) {
    await this.withSeedSteps(db, async (steps) => {
      for (const s of steps) {
        const r = await s.apply();
        if (!r.success) throw new Error(`${r.service} 시드 실패: ${r.error ?? '(원인 미상)'}`);
      }
    });
  }

  async warehouseCount(db: string) {
    return this.withSql(db, async (sql) => Number((await sql`SELECT count(*)::int AS n FROM warehouses`)[0].n));
  }

  async cronRuns(db: string) {
    if (!(await this.exists(db))) return { rows: 0, duplicatedPeriods: 0 };
    return this.withSql(db, async (sql) => {
      const [t] = await sql`SELECT to_regclass('public.cron_runs') AS t`;
      if (!t?.t) return { rows: 0, duplicatedPeriods: 0 };
      const [r] = await sql`SELECT count(*)::int AS n FROM cron_runs`;
      const [d] = await sql`
        SELECT count(*)::int AS n FROM (
          SELECT 1 FROM cron_runs GROUP BY name, period_at HAVING count(*) > 1
        ) dup`;
      return { rows: Number(r.n), duplicatedPeriods: Number(d.n) };
    });
  }
}
