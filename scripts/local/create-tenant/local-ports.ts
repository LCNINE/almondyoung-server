import { execFileSync, spawn } from 'node:child_process';
import { chmod, mkdir, readFile, readdir, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, join } from 'node:path';
import postgres from 'postgres';
import { parse as parseEnv } from 'dotenv';
import type { TenantEntry } from '../../../libs/tenancy/src/tenant-list';
import { buildCoreSeedSteps } from '../../seeding/lib/core-seed-steps';
import type {
  Buckets,
  CheckAccountSecret,
  CoreDatabases,
  Deployment,
  TenantListTarget,
} from '../../tenancy/create-tenant/steps';
import { addTenantToEnv, envListsTenant, removeTenantFromEnv } from '../../tenancy/create-tenant/tenant-list-env';

/** 로컬 E2E 의 어댑터들. 라이브 짝(RDS·S3·Secret·배포)은 아직 없다. */

export const REPO = join(__dirname, '..', '..', '..');

const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;
function ident(db: string): string {
  if (!IDENT.test(db)) throw new Error(`DB 이름이 식별자 규칙 밖이다: ${db}`);
  return `"${db}"`;
}

export function readEnvFile(path: string): Record<string, string> {
  return existsSync(path) ? parseEnv(readFileSync(path)) : {};
}

// ─────────────────────────────────────────── core DB (로컬 postgres)

export class LocalCoreDatabases implements CoreDatabases {
  constructor(private readonly pg: string) {}

  private url(db: string) {
    return `${this.pg}/${db}`;
  }

  private async withSql<T>(db: string, fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
    const sql = postgres(this.url(db), { max: 1, onnotice: () => undefined });
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
    // migrate-all.sh 와 같은 방식 — DATABASE_URL 을 명시 주입해 .env 가 어디를 가리키든 로컬만 건드린다.
    execFileSync('npx', ['drizzle-kit', 'migrate', '--config', 'apps/core/drizzle.config.ts'], {
      cwd: REPO,
      env: { ...process.env, DATABASE_URL: this.url(db) },
      stdio: ['ignore', 'ignore', 'pipe'],
      timeout: 180_000,
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

// ─────────────────────────────────────────── 버킷 = file-service 로컬 디스크 드라이버의 버킷 디렉터리(<root>/<bucket>)

export class LocalDiskBuckets implements Buckets {
  constructor(private readonly root: string) {}

  private dir(bucket: string) {
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error(`버킷 이름 규칙 밖: ${bucket}`);
    return join(this.root, bucket);
  }

  async exists(bucket: string) {
    try {
      return (await stat(this.dir(bucket))).isDirectory();
    } catch {
      return false;
    }
  }

  async create(bucket: string) {
    await mkdir(this.dir(bucket), { recursive: true });
  }

  async removeIfEmpty(bucket: string) {
    if (!(await this.exists(bucket))) return;
    if ((await readdir(this.dir(bucket))).length > 0) throw new Error(`버킷 ${bucket} 이 비어 있지 않아 남긴다`);
    await rmdir(this.dir(bucket));
  }

  async probe(bucket: string) {
    const file = join(this.dir(bucket), `.tenant-create-probe-${process.pid}-${Date.now()}`);
    const body = `probe ${new Date().toISOString()}`;
    await writeFile(file, body);
    try {
      if ((await readFile(file, 'utf8')) !== body) throw new Error('읽은 내용이 쓴 내용과 다르다');
    } finally {
      await rm(file, { force: true });
    }
  }
}

// ─────────────────────────────────────────── 목록 = kind=nest 앱 .env 들의 TENANT_LIST

export class LocalEnvTenantList implements TenantListTarget {
  constructor(private readonly envFiles: string[]) {
    if (envFiles.length === 0) throw new Error('목록을 받을 .env 가 하나도 없다');
  }

  async lists(entry: TenantEntry) {
    for (const f of this.envFiles) if (!envListsTenant(await readFile(f, 'utf8'), entry)) return false;
    return true;
  }

  async add(entry: TenantEntry) {
    // 먼저 전부 고쳐 보고(틀린 목록·다른 값이면 여기서 던진다) 그다음에 쓴다 — 반쯤 넣은 상태를 덜 만든다.
    const next = await Promise.all(
      this.envFiles.map(async (f) => [f, addTenantToEnv(await readFile(f, 'utf8'), entry)] as const),
    );
    for (const [f, text] of next) await writeFile(f, text);
  }

  async remove(tenantId: string) {
    for (const f of this.envFiles) {
      const text = await readFile(f, 'utf8');
      const next = removeTenantFromEnv(text, tenantId);
      if (next !== text) await writeFile(f, next);
    }
  }
}

// ─────────────────────────────────────────── 점검 계정 비밀번호 (라이브 = SST Secret, 로컬 = git 밖 파일)

export class LocalCheckAccountSecret implements CheckAccountSecret {
  constructor(private readonly path: string) {}

  async has() {
    return existsSync(this.path);
  }

  async save(loginId: string, password: string) {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, `${JSON.stringify({ loginId, password }, null, 2)}\n`, { mode: 0o600 });
    await chmod(this.path, 0o600);
  }
}

// ─────────────────────────────────────────── 한 번에 하나

/**
 * 두 실행이 겹치면 한쪽의 되돌리기가 다른 쪽이 막 만든 DB 를 지운다. pid 파일로 막는다 — 주인이 죽었으면 넘겨받는다.
 * (flock 은 macOS 에 없다.)
 */
export function takeRunLock(path: string): () => void {
  const take = () => writeFileSync(path, String(process.pid), { flag: 'wx' });
  try {
    take();
  } catch {
    const owner = Number(readFileSync(path, 'utf8'));
    if (owner && isAlive(owner)) throw new Error(`이미 돌고 있다 (pid ${owner}) — 끝난 뒤 다시 돌릴 것`);
    unlinkSync(path);
    take();
  }
  return () => {
    if (existsSync(path) && readFileSync(path, 'utf8') === String(process.pid)) unlinkSync(path);
  };
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────── 앱 임시 기동

export function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = connect({ port, host: '127.0.0.1' });
    s.once('connect', () => {
      s.destroy();
      resolve(true);
    });
    s.once('error', () => resolve(false));
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(what: string, timeoutMs: number, probe: () => Promise<boolean>) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await probe()) return;
    await sleep(2000);
  }
  throw new Error(`${what} — ${Math.round(timeoutMs / 1000)}초 안에 안 됐다`);
}

export interface RunningApp {
  stop(): Promise<void>;
}

const pidFileOf = (name: string) => join(REPO, 'logs', `.tenant-create-${name}.pid`);
const startedHere = new Set<RunningApp>();

/** 이 실행이 띄운 앱을 전부 내린다 — 신호(Ctrl+C·kill)로 끝날 때 고아를 남기지 않게. */
export async function stopStartedApps(): Promise<void> {
  for (const app of [...startedHere]) await app.stop();
}

/**
 * 지난 실행이 SIGKILL 로 죽으면서 남긴 임시 앱을 내린다. pid 파일이 있고 그 프로세스의 명령줄이 그 앱의 dist 일 때만 —
 * start-all 이 띄운 앱은 pid 파일이 없어 건드리지 않는다.
 */
async function reapOrphan(name: string, target: string, port: number, log: (line: string) => void) {
  const file = pidFileOf(name);
  if (!existsSync(file)) return;
  const pid = Number(readFileSync(file, 'utf8'));
  unlinkSync(file);
  if (!pid || !isAlive(pid)) return;
  let args = '';
  try {
    args = execFileSync('ps', ['-p', String(pid), '-o', 'args='], { encoding: 'utf8' });
  } catch {
    return;
  }
  if (!args.includes(`dist/apps/${target}/main.js`)) return;
  log(`  지난 실행이 남긴 ${name}(pid ${pid}) 를 내린다`);
  process.kill(pid, 'SIGTERM');
  try {
    await waitFor(`${name} :${port} 닫힘`, 20_000, async () => !(await portOpen(port)));
  } catch {
    if (isAlive(pid)) process.kill(pid, 'SIGKILL');
  }
}

/**
 * nest 앱을 빌드해 잠깐 띄운다(start-all 과 같은 dist + .env, 셸 값이 .env 를 이긴다 — dotenv-cli 와 같다).
 * 그 포트가 이미 열려 있으면 `ifRunning` 대로: `reuse` 는 그대로 쓰고 끄지 않는다(돌고 있는 세션을 죽이지 않는다 —
 * bootstrap 의 kafka 규칙과 같다), `refuse` 는 그 메시지로 던진다.
 */
export async function ensureNestApp(opts: {
  name: string;
  target: string;
  port: number;
  envFile: string;
  extraEnv?: Record<string, string>;
  ifRunning: 'reuse' | { refuse: string };
  log: (line: string) => void;
}): Promise<RunningApp> {
  await reapOrphan(opts.name, opts.target, opts.port, opts.log);
  if (await portOpen(opts.port)) {
    if (opts.ifRunning === 'reuse') return { stop: async () => undefined };
    throw new Error(opts.ifRunning.refuse);
  }

  opts.log(`  ${opts.name} 가 안 떠 있어 잠깐 띄운다 (빌드 → :${opts.port}, 로그 logs/${opts.name}.tenant-create.log)`);
  execFileSync('npx', ['nest', 'build', opts.target], { cwd: REPO, stdio: ['ignore', 'ignore', 'pipe'] });
  await mkdir(join(REPO, 'logs'), { recursive: true });
  const out = openSync(join(REPO, 'logs', `${opts.name}.tenant-create.log`), 'w');
  const child = spawn('node', [`dist/apps/${opts.target}/main.js`], {
    cwd: REPO,
    env: { ...readEnvFile(opts.envFile), ...process.env, ...opts.extraEnv },
    stdio: ['ignore', out, out],
  });
  if (child.pid) writeFileSync(pidFileOf(opts.name), String(child.pid));
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  let dead = false;
  void exited.then(() => (dead = true));

  const app: RunningApp = {
    async stop() {
      startedHere.delete(app);
      if (!dead) {
        child.kill('SIGTERM');
        await Promise.race([exited, sleep(15_000)]);
        if (!dead) child.kill('SIGKILL');
      }
      if (existsSync(pidFileOf(opts.name))) unlinkSync(pidFileOf(opts.name));
    },
  };
  startedHere.add(app);

  try {
    await waitFor(`${opts.name} :${opts.port}`, 180_000, async () => {
      if (dead) throw new Error(`${opts.name} 가 뜨다가 죽었다 — logs/${opts.name}.tenant-create.log`);
      return portOpen(opts.port);
    });
  } catch (e) {
    await app.stop();
    throw e;
  }
  return app;
}

/**
 * 로컬의 «배포»: 목록을 받은 core 를 ② 모드로 띄워 크론이 새 테넌트 DB 에서 한 주기 돌게 한다.
 * core 가 이미 떠 있으면 옛 목록으로 떠 있는 것이라 못 쓴다 — 돌고 있는 세션을 죽이지 않고 할 일을 알린다.
 */
export class LocalCoreDeployment implements Deployment {
  constructor(
    private readonly opts: {
      port: number;
      envFile: string;
      databases: CoreDatabases;
      log: (line: string) => void;
    },
  ) {}

  describe() {
    return '로컬 배포 — core 를 ② 모드로 띄워 크론 한 주기';
  }

  async run(entry: TenantEntry) {
    const core = await ensureNestApp({
      name: 'core',
      target: 'core',
      port: this.opts.port,
      envFile: this.opts.envFile,
      extraEnv: { TENANT_GATE_MODE: 'reject' },
      ifRunning: {
        refuse:
          `core(:${this.opts.port}) 가 이미 떠 있다 — 새 목록을 받기 전에 뜬 core 라 이 테넌트를 섬기지 않는다. ` +
          `앱을 내리고(Ctrl+C) 다시 돌리거나, E2E_GATE_MODE=reject npm run start:all:local 로 다시 띄운 뒤 다시 돌릴 것`,
      },
      log: this.opts.log,
    });
    try {
      await waitFor(`${entry.coreDb} 의 cron_runs 첫 행`, 120_000, async () => {
        return (await this.opts.databases.cronRuns(entry.coreDb)).rows > 0;
      });
    } finally {
      await core.stop();
    }
  }
}
