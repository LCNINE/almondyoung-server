import postgres, { Sql } from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { SeedCheckResult, SeedApplyResult } from '../lib/types';
import { Logger } from '../lib/logger';

export abstract class SeedStep {
  protected logger: Logger;
  protected client: Sql;
  protected db: PostgresJsDatabase;

  /**
   * 이 step이 속한 시드 그룹들. orchestrator는 사용자가 선택한 그룹에 포함된
   * step만 필터링해서 실행한다. 같은 step이 여러 그룹에 속할 수 있다.
   * 예: ['baseline'], ['demo-salon'], ['baseline', 'demo-salon']
   */
  abstract readonly groups: readonly string[];

  constructor(
    public readonly serviceName: string,
    protected readonly databaseUrl: string,
  ) {
    this.logger = new Logger(serviceName);
    this.client = postgres(toPostgresJsUrl(databaseUrl));
    this.db = drizzle(this.client);
  }

  /** Phase 1: 현재 상태 확인 — 뭐가 있고 뭐가 빠졌는지 */
  abstract check(): Promise<SeedCheckResult>;

  /** Phase 2: 빠진 레코드만 삽입 */
  abstract apply(): Promise<SeedApplyResult>;

  /** DB 커넥션 정리 */
  async dispose(): Promise<void> {
    await this.client.end();
  }

  /** 특정 ID들 중 DB에 존재하는 것들의 Set 반환 */
  protected async findExistingIds(table: string, ids: string[], idColumn = 'id'): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.client`
      SELECT ${this.client(idColumn)}::text as id
      FROM ${this.client(table)}
      WHERE ${this.client(idColumn)} = ANY(${ids})
    `;
    return new Set(rows.map((r) => r.id));
  }

  /** 특정 키들 중 DB에 존재하는 것들의 Set 반환 (auth.scopes 등 non-uuid PK 용) */
  protected async findExistingKeys(
    table: string,
    keys: string[],
    keyColumn: string,
    schema?: string,
  ): Promise<Set<string>> {
    if (keys.length === 0) return new Set();
    const fullTable = schema ? `${schema}.${table}` : table;
    const rows = await this.client.unsafe(
      `SELECT "${keyColumn}"::text as key FROM ${fullTable} WHERE "${keyColumn}" = ANY($1)`,
      [keys],
    );
    return new Set(rows.map((r) => r.key));
  }

  /** 테이블의 전체 row 수 */
  protected async countRows(table: string, schema?: string): Promise<number> {
    const fullTable = schema ? `${schema}.${table}` : table;
    const rows = await this.client.unsafe(`SELECT count(*)::int as count FROM ${fullTable}`);
    return rows[0].count;
  }
}

function toPostgresJsUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.delete('uselibpqcompat');
  return url.toString();
}
