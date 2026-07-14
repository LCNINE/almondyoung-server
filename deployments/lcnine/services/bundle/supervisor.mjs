// ServicesBundle supervisor — 단일 Fargate 태스크에서 경량 서비스 6개를 각각 별도 Node
// 프로세스로 기동/감독한다. 외부 의존성 없는 단일 파일 (pm2 등 추가 금지).
//
// 책임 (설계 문서 §5.2):
//  1. spawn  : `node dist/apps/<dir>/main.js` × 6. 각 자식 env 는 아래 규칙으로 조립.
//  2. restart: 자식 종료 시 지수 백오프(1s→…→30s)로 무한 재시작 (태스크 전체를 죽이지 않음).
//  3. graceful shutdown: SIGTERM → 전 자식에 SIGTERM 전파 → 모두 종료 대기(최대 55s) → exit 0.
//
// env 조립 규칙:
//  - 공유 env (프리픽스 없음): NODE_ENV / OTEL_EXPORTER_OTLP_ENDPOINT 등 전 앱 공통 값은 그대로 상속.
//  - 앱별 env: 태스크 env 의 `<PREFIX>__KEY` (예: ANALYTICS__DATABASE_URL) 를 프리픽스 제거 후 주입.
//  - PORT / OTEL_SERVICE_NAME: supervisor 가 앱별 상수로 직접 지정 (아래 APPS 테이블).
//
// 자식 stdout/stderr 는 그대로 상속 → pino JSON 로그가 CloudWatch 로 직행 (각 로그에 service_name
// 이 이미 박혀 있어 구분됨). supervisor 자체 로그도 동일한 JSON 형태(service_name=services-supervisor).

import { spawn } from 'node:child_process';

// dir: dist/apps/<dir>/main.js 의 폴더명(=nest 앱 이름).
// prefix: 태스크 env 에서 이 앱으로 주입할 `<prefix>__KEY` 프리픽스.
// port: supervisor 가 PORT 로 주입 (ALB 룰의 forward 포트와 일치해야 함).
// otel: OTEL_SERVICE_NAME (Grafana service_name 라벨 연속성 — 기존 개별 배포 값 그대로).
const APPS = [
  { dir: 'analytics', prefix: 'ANALYTICS', port: 3040, otel: 'analytics' },
  { dir: 'channel-adapter', prefix: 'CHANNEL_ADAPTER', port: 3001, otel: 'channel-adapter' },
  { dir: 'membership', prefix: 'MEMBERSHIP', port: 3002, otel: 'membership' },
  { dir: 'notification', prefix: 'NOTIFICATION', port: 3003, otel: 'notification' },
  { dir: 'search', prefix: 'SEARCH', port: 3004, otel: 'search' },
  { dir: 'ugc-service', prefix: 'UGC', port: 3030, otel: 'ugc' },
];

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const STABLE_UPTIME_MS = 60_000; // 이 시간 이상 살아있었으면 안정 기동으로 보고 백오프 리셋
// ECS Fargate 기본 stopTimeout=30s (SST 가 container stopTimeout 을 노출하지 않아 상향 불가).
// ECS 가 30s 에 SIGKILL 하기 전에 스스로 정리하고 exit 0 하도록 28s 로 잡는다.
// channel-adapter inbox drain(INBOX_SHUTDOWN_DRAIN_MS=25s)이 최장 → 30s 안에 fits.
const GRACEFUL_TIMEOUT_MS = 28_000;

// 한 태스크가 실행할 앱 부분집합. ECS service 는 LB 설정(타깃그룹)을 최대 5개만 허용하므로
// 6개를 한 서비스에 못 붙인다 → 여러 태스크로 나누고 각 태스크가 BUNDLE_APPS(dir 콤마목록)로
// 담당 앱을 지정한다. 미설정 시(로컬 등) 전체 실행.
const ONLY = (process.env.BUNDLE_APPS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const RUN_APPS = ONLY.length ? APPS.filter((a) => ONLY.includes(a.dir)) : APPS;

const ALL_PREFIXES = APPS.map((a) => `${a.prefix}__`);

/** service_name 라벨을 박은 JSON 한 줄 로그 (Loki 필터용). */
function log(msg, extra) {
  process.stdout.write(
    JSON.stringify({
      level: 'info',
      service_name: 'services-supervisor',
      time: new Date().toISOString(),
      msg,
      ...extra,
    }) + '\n',
  );
}

/** 한 앱에 넘길 자식 프로세스 env 를 조립한다. */
function buildChildEnv(app) {
  const env = {};
  const own = `${app.prefix}__`;

  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    // 다른 앱의 프리픽스가 붙은 값은 공유 env 로 흘려보내지 않는다.
    if (ALL_PREFIXES.some((p) => key.startsWith(p))) {
      // 내 프리픽스면 벗겨서 주입.
      if (key.startsWith(own)) env[key.slice(own.length)] = value;
      continue;
    }
    // 프리픽스 없는 공유 env 는 그대로.
    env[key] = value;
  }

  // supervisor 가 직접 지정하는 앱별 상수 (프리픽스 주입값이 있어도 덮어씀).
  env.PORT = String(app.port);
  env.OTEL_SERVICE_NAME = app.otel;
  return env;
}

// dir -> { app, proc, startedAt, backoffMs }
const state = new Map();
let shuttingDown = false;

function start(app) {
  const proc = spawn('node', [`dist/apps/${app.dir}/main.js`], {
    env: buildChildEnv(app),
    stdio: 'inherit',
  });

  const entry = state.get(app.dir) ?? { app, backoffMs: INITIAL_BACKOFF_MS };
  entry.proc = proc;
  entry.startedAt = Date.now();
  state.set(app.dir, entry);

  log(`spawned ${app.dir}`, { pid: proc.pid, port: app.port, otel: app.otel });

  proc.on('error', (err) => {
    log(`failed to spawn ${app.dir}`, { error: String(err) });
  });

  proc.on('exit', (code, signal) => {
    entry.proc = null;

    if (shuttingDown) {
      log(`${app.dir} exited during shutdown`, { code, signal });
      finishShutdownIfDone();
      return;
    }

    const uptime = Date.now() - entry.startedAt;
    if (uptime >= STABLE_UPTIME_MS) entry.backoffMs = INITIAL_BACKOFF_MS;
    const wait = entry.backoffMs;
    entry.backoffMs = Math.min(entry.backoffMs * 2, MAX_BACKOFF_MS);

    log(`${app.dir} exited; restarting`, { code, signal, uptimeMs: uptime, restartInMs: wait });
    const timer = setTimeout(() => {
      if (shuttingDown) return; // 종료 중이면 재기동하지 않는다 (백오프 대기 중 SIGTERM 대비)
      start(app);
    }, wait);
    timer.unref();
  });
}

function finishShutdownIfDone() {
  const alive = [...state.values()].filter((e) => e.proc);
  if (alive.length === 0) {
    log('all children exited; supervisor exiting 0');
    process.exit(0);
  }
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log('shutdown signal received; propagating SIGTERM to children', { signal });

  for (const entry of state.values()) {
    if (entry.proc) entry.proc.kill('SIGTERM');
  }

  const timer = setTimeout(() => {
    log('graceful timeout reached; forcing SIGKILL', { timeoutMs: GRACEFUL_TIMEOUT_MS });
    for (const entry of state.values()) {
      if (entry.proc) entry.proc.kill('SIGKILL');
    }
    process.exit(0);
  }, GRACEFUL_TIMEOUT_MS);
  timer.unref();

  finishShutdownIfDone();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

if (!RUN_APPS.length) {
  log('no apps to run — BUNDLE_APPS 가 어떤 앱과도 매칭되지 않음', { BUNDLE_APPS: process.env.BUNDLE_APPS });
  process.exit(1);
}
log(`supervisor starting ${RUN_APPS.length} apps`, { apps: RUN_APPS.map((a) => a.dir) });
for (const app of RUN_APPS) start(app);
