import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const PRODUCTION_SERVER_URL = 'https://core.almondyoung.com';

// Codex 와 그 아래 Blender·Python 에 넘기는 환경변수 — 워커 키·서버 주소·테넌트는 하나도 넘기지 않는다
const CHILD_ENV_ALLOW = [
  'PATH',
  'PATHEXT',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'USERPROFILE',
  'HOME',
  'APPDATA',
  'LOCALAPPDATA',
  'TEMP',
  'TMP',
  'CODEX_HOME',
  'BLENDER_PATH',
  'NODE_BIN',
  'GLTF_TRANSFORM_CLI',
];

export function childEnv(env) {
  const out = {};

  // Windows 는 이름 대소문자를 가리지 않는다(Path·PATH)
  for (const [name, value] of Object.entries(env)) {
    if (CHILD_ENV_ALLOW.includes(name.toUpperCase()) && value !== undefined) {
      out[name] = value;
    }
  }

  return out;
}

const REQUIRED = [
  'SKU3D_SERVER_URL',
  'SKU3D_TENANT_ID',
  'SKU3D_WORKER_KEY',
  'SKU3D_WORK_ROOT',
  'CODEX_BIN',
  'BLENDER_PATH',
  'GLTF_TRANSFORM_CLI',
  'GLTF_VALIDATOR_MODULE',
  'EDGE_BIN',
  'SKU3D_CODEX_HOME',
  'SKU3D_DENY_READ',
];

const PATHS = ['CODEX_BIN', 'BLENDER_PATH', 'GLTF_TRANSFORM_CLI', 'GLTF_VALIDATOR_MODULE', 'EDGE_BIN'];

export function loadConfig(env, exists = existsSync) {
  const missing = REQUIRED.filter((name) => !env[name]);

  if (missing.length > 0) {
    throw new Error(`설정이 비어 있어요: ${missing.join(', ')}`);
  }

  const absent = PATHS.filter((name) => !exists(env[name]));

  if (absent.length > 0) {
    throw new Error(`경로에 파일이 없어요: ${absent.map((n) => `${n}=${env[n]}`).join(', ')}`);
  }

  const serverUrl = env.SKU3D_SERVER_URL.replace(/\/+$/, '');

  if (!serverUrl.startsWith('https://') && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(serverUrl)) {
    throw new Error('SKU3D_SERVER_URL 은 https 여야 해요');
  }

  return {
    serverUrl,
    devConnection: serverUrl !== PRODUCTION_SERVER_URL,
    tenantId: env.SKU3D_TENANT_ID,
    workerKey: env.SKU3D_WORKER_KEY,
    hostId: env.SKU3D_HOST_ID ?? 'sku-3d-worker',
    workRoot: env.SKU3D_WORK_ROOT,
    codexBin: env.CODEX_BIN,
    blenderPath: env.BLENDER_PATH,
    nodeBin: env.NODE_BIN ?? process.execPath,
    gltfTransformCli: env.GLTF_TRANSFORM_CLI,
    gltfValidatorModule: env.GLTF_VALIDATOR_MODULE,
    edgeBin: env.EDGE_BIN,
    // 워커 전용 Codex 홈 — 평소 쓰는 Codex 설정과 섞지 않고, 작업마다 권한 프로필을 여기 쓴다
    codexHome: env.SKU3D_CODEX_HOME,
    // 읽기를 막을 경로(설정·키 폴더 등). ; 로 나눈다
    denyRead: env.SKU3D_DENY_READ.split(';').map((p) => p.trim()).filter(Boolean),
    userCodexHome: join(env.USERPROFILE ?? env.HOME ?? '', '.codex'),
    windowsSandbox: env.SKU3D_WINDOWS_SANDBOX ?? 'mxc',
    concurrency: Number(env.SKU3D_CONCURRENCY ?? 1),
    pollMs: Number(env.SKU3D_POLL_MS ?? 5000),
    jobTimeoutMs: Number(env.SKU3D_JOB_TIMEOUT_MIN ?? 60) * 60_000,
  };
}
