// Codex 가 실행하는 명령(Blender·Python·셸)의 격리.
// sandbox_mode="workspace-write" 는 쓰기만 막고 읽기는 디스크 전체라, 권한 프로필로 읽기·네트워크까지 막는다.
// 공식 문서: 권한 프로필과 sandbox_mode 는 함께 쓰지 않는다 / Windows unelevated 샌드박스는 읽기 차단을 지원하지 않는다
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const PROFILE = 'sku3d-job';

function tomlKey(path) {
  if (path.includes("'")) {
    throw new Error(`경로에 작은따옴표가 있으면 쓸 수 없어요: ${path}`);
  }

  // 작은따옴표 키는 TOML 리터럴이라 Windows 역슬래시를 그대로 둔다
  return `'${path}'`;
}

export function sandboxConfigToml({ writeDir, denyPaths, windowsSandbox }) {
  const lines = [
    '# sku-3d-worker 가 작업마다 다시 쓴다 — 손으로 고치지 말 것',
    `default_permissions = "${PROFILE}"`,
    '',
    '[windows]',
    `sandbox = "${windowsSandbox}"`,
    '',
    `[permissions.${PROFILE}.filesystem]`,
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

    return ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', `try { ${body}; 'PROBE_ALLOWED' } catch { 'PROBE_DENIED' }`];
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

  // 샌드박스가 명령을 아예 띄우지 못해도 막힌 것이다(표시가 안 나온다)
  return 'denied';
}

function runInSandbox({ codexBin, codexHome, cwd, env, command }) {
  return new Promise((resolvePromise) => {
    const child = spawn(codexBin, ['sandbox', '--', ...command], {
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
export async function isolationCheck({ codexBin, codexHome, workRoot, denyRead, userCodexHome, windowsSandbox, env }) {
  const probeDir = join(workRoot, '_isolation-check');
  const neighborDir = join(workRoot, '_isolation-neighbor');

  mkdirSync(probeDir, { recursive: true });
  mkdirSync(neighborDir, { recursive: true });

  const denyPaths = denyPathsFor({ workRoot, workshopDir: probeDir, denyRead, codexHome, userCodexHome });

  writeSandboxConfig(codexHome, { writeDir: probeDir, denyPaths, windowsSandbox });

  const probes = [
    ...denyRead.map((path) => ({ name: `읽기 차단: ${path}`, kind: 'read', target: readProbeTarget(path), want: 'denied' })),
    { name: `쓰기 차단: ${neighborDir}`, kind: 'write', target: join(neighborDir, 'probe.txt'), want: 'denied' },
    { name: '인터넷 차단', kind: 'network', target: 'https://example.com', want: 'denied' },
    { name: `작업 폴더 쓰기 허용: ${probeDir}`, kind: 'write', target: join(probeDir, 'probe.txt'), want: 'allowed' },
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

    results.push({ ...probe, got, ok: got === probe.want, note: run.failedToRun ? run.output : '' });
  }

  return { ok: results.every((r) => r.ok), results, configPath: join(codexHome, 'config.toml'), denyPaths, probeParent: dirname(probeDir) };
}
