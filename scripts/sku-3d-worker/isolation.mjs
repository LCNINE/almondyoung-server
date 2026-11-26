// Codex 가 실행하는 명령(Blender·Python·셸)의 격리.
// sandbox_mode="workspace-write" 는 쓰기만 막고 읽기는 디스크 전체라, 권한 프로필로 읽기·네트워크까지 막는다.
// 공식 문서: 권한 프로필과 sandbox_mode 는 함께 쓰지 않는다 / Windows unelevated 샌드박스는 읽기 차단을 지원하지 않는다
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const PROFILE = 'sku3d-job';

// 권한 프로필은 C:/... 슬래시 경로로 쓴다 — 역슬래시 경로 규칙은 Windows 실측에서 적용되지 않았다
export function profilePath(path) {
  return path.replace(/\\/g, '/');
}

function tomlKey(path) {
  if (path.includes("'")) {
    throw new Error(`경로에 작은따옴표가 있으면 쓸 수 없어요: ${path}`);
  }

  return `'${profilePath(path)}'`;
}

// Codex 안에서 부르는 도구(Blender·Node·gltf-transform)의 설치 폴더 — 읽지 못하면 도구가 뜨지 않는다
export function toolReadPaths({ blenderPath, nodeBin, gltfTransformCli }) {
  const nodeModules = gltfTransformCli.match(/^(.*[\\/]node_modules)[\\/]/)?.[1] ?? dirname(gltfTransformCli);

  return [...new Set([dirname(blenderPath), dirname(nodeBin), nodeModules].map((p) => resolve(p)))];
}

// 읽기 허용이 없으면 MXC 는 상위 폴더도 못 읽어 작업 폴더 쓰기까지 막힌다(Windows 실측) — :minimal 과 도구 폴더만 연다
export function sandboxConfigToml({ writeDir, readPaths = [], denyPaths, windowsSandbox }) {
  const lines = [
    '# sku-3d-worker 가 작업마다 다시 쓴다 — 손으로 고치지 말 것',
    `default_permissions = "${PROFILE}"`,
    '',
    '[windows]',
    `sandbox = "${windowsSandbox}"`,
    '',
    `[permissions.${PROFILE}.filesystem]`,
    `':minimal' = "read"`,
    ...readPaths.map((path) => `${tomlKey(path)} = "read"`),
    `${tomlKey(writeDir)} = "write"`,
    ...denyPaths.map((path) => `${tomlKey(path)} = "deny"`),
    '',
    `[permissions.${PROFILE}.network]`,
    'enabled = false',
    '',
  ];

  return lines.join('\n');
}

// 이번 작업실만 쓰고, 다른 작업실·설정·키·로그인 정보는 읽지도 못하게
export function denyPathsFor({ workRoot, workshopDir, denyRead, codexHome, userCodexHome }) {
  const current = resolve(workshopDir);
  const siblings = existsSync(workRoot)
    ? readdirSync(workRoot)
        .map((name) => resolve(workRoot, name))
        .filter((path) => path !== current && statSync(path).isDirectory())
    : [];

  return [...new Set([...denyRead, codexHome, userCodexHome, ...siblings].filter(Boolean).map((p) => resolve(p)))];
}

export function writeSandboxConfig(codexHome, options) {
  mkdirSync(codexHome, { recursive: true });
  writeFileSync(join(codexHome, 'config.toml'), sandboxConfigToml(options));
}

// 읽기를 막은 경로에서 실제로 열어 볼 파일 — 폴더면 안의 첫 파일
export function readProbeTarget(path) {
  if (!existsSync(path)) {
    return null;
  }

  if (!statSync(path).isDirectory()) {
    return path;
  }

  const file = readdirSync(path).find((name) => statSync(join(path, name)).isFile());

  return file ? join(path, file) : null;
}

// 결과는 ALLOWED/DENIED 표시만 낸다 — 파일 내용은 출력하지 않는다
export function probeScript(kind, target, platform = process.platform) {
  if (platform === 'win32') {
    const quoted = target.replace(/'/g, "''");
    const body = {
      read: `$f = [System.IO.File]::OpenRead('${quoted}'); $f.Close()`,
      write: `Set-Content -LiteralPath '${quoted}' -Value 'x' -ErrorAction Stop; Remove-Item -LiteralPath '${quoted}'`,
      network: `Invoke-WebRequest -Uri '${quoted}' -UseBasicParsing -TimeoutSec 8 | Out-Null`,
    }[kind];

    return [
      'powershell.exe',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `try { ${body}; 'PROBE_ALLOWED' } catch { 'PROBE_DENIED ' + $_.Exception.GetType().Name }`,
    ];
  }

  const body = {
    read: `head -c 1 '${target}' > /dev/null`,
    write: `echo x > '${target}' && rm -f '${target}'`,
    network: `curl -s -o /dev/null --max-time 8 '${target}'`,
  }[kind];

  return ['sh', '-c', `if ${body} 2>/dev/null; then echo PROBE_ALLOWED; else echo PROBE_DENIED; fi`];
}

export function probeVerdict(output) {
  if (output.includes('PROBE_ALLOWED')) {
    return 'allowed';
  }

  if (output.includes('PROBE_DENIED')) {
    return 'denied';
  }

  // 표시가 없으면 명령이 돌지 않은 것이다 — 막힘으로 치면 잘못 부른 검사가 차단 항목을 통과시킨다
  return 'error';
}

// 0.166 부터 -P·-C 가 필수다. 없던 버전에선 프로필 대신 기본 정책으로 돌아 검사가 엉뚱한 것을 잰다
export function sandboxArgs(cwd, command) {
  return ['sandbox', '-P', PROFILE, '-C', cwd, '--', ...command];
}

function runInSandbox({ codexBin, codexHome, cwd, env, command }) {
  return new Promise((resolvePromise) => {
    const child = spawn(codexBin, sandboxArgs(cwd, command), {
      cwd,
      env: { ...env, CODEX_HOME: codexHome },
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const timer = setTimeout(() => child.kill(), 60_000);

    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolvePromise({ output: `실행 실패: ${error.message}`, failedToRun: true });
    });
    child.on('close', () => {
      clearTimeout(timer);
      resolvePromise({ output, failedToRun: false });
    });
  });
}

// 모델 없이 같은 권한 프로필로 명령을 직접 띄워 본다. 하나라도 뚫리면 실패
export async function isolationCheck({ codexBin, codexHome, workRoot, denyRead, userCodexHome, windowsSandbox, readPaths, blenderPath, env }) {
  const probeDir = join(workRoot, '_isolation-check');
  const neighborDir = join(workRoot, '_isolation-neighbor');
  const neighborCanary = join(neighborDir, 'canary.txt');

  mkdirSync(probeDir, { recursive: true });
  mkdirSync(neighborDir, { recursive: true });
  // 다른 작업실 읽기 차단이 규칙으로 먹는지 보려고 둔다 — 기본 읽기 전용으로는 읽기가 막히지 않는다
  writeFileSync(neighborCanary, 'canary');

  const denyPaths = denyPathsFor({ workRoot, workshopDir: probeDir, denyRead, codexHome, userCodexHome });

  writeSandboxConfig(codexHome, { writeDir: probeDir, readPaths, denyPaths, windowsSandbox });

  const probes = [
    ...denyRead.map((path) => ({ name: `읽기 차단: ${path}`, kind: 'read', target: readProbeTarget(path), want: 'denied' })),
    { name: `다른 작업실 읽기 차단: ${neighborDir}`, kind: 'read', target: neighborCanary, want: 'denied' },
    { name: `다른 작업실 쓰기 차단: ${neighborDir}`, kind: 'write', target: join(neighborDir, 'probe.txt'), want: 'denied' },
    { name: '인터넷 차단', kind: 'network', target: 'https://example.com', want: 'denied' },
    { name: `작업 폴더 쓰기 허용: ${probeDir}`, kind: 'write', target: join(probeDir, 'probe.txt'), want: 'allowed' },
    { name: `도구 읽기 허용: ${blenderPath}`, kind: 'read', target: blenderPath, want: 'allowed' },
  ];
  const results = [];

  for (const probe of probes) {
    if (!probe.target) {
      results.push({ ...probe, got: 'skipped', ok: false, note: '확인할 파일이 없어요' });

      continue;
    }

    const run = await runInSandbox({
      codexBin,
      codexHome,
      cwd: probeDir,
      env,
      command: probeScript(probe.kind, probe.target),
    });
    const got = run.failedToRun ? 'error' : probeVerdict(run.output);
    const ok = got === probe.want;

    // 기대와 다르면 샌드박스 출력을 남겨 원인을 바로 본다(probe 는 파일 내용을 출력하지 않는다)
    results.push({ ...probe, got, ok, note: ok ? '' : run.output.trim().slice(-400) });
  }

  return { ok: results.every((r) => r.ok), results, configPath: join(codexHome, 'config.toml'), denyPaths, probeParent: dirname(probeDir) };
}
