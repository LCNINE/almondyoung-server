import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ApiError, createApi, isLeaseLost } from './api.mjs';
import { codexArgs, readCodexEvent, runCodex } from './codex-run.mjs';
import { childEnv, loadConfig, PRODUCTION_SERVER_URL } from './env.mjs';
import { externalUris, GLB_MAX_BYTES, glbJson, judgeOutputs, reviewProblem } from './judge.mjs';
import { viewerHtml, viewerShotOf, viewerStateOf } from './viewer-check.mjs';
import { buildPrompt, changeLines, DONE_MARKER, finishedFor, hasSharp, imageExtOf, runJob } from './worker.mjs';
import { denyPathsFor, probeScript, probeVerdict, profilePath, sandboxArgs, sandboxConfigToml, toolReadPaths } from './isolation.mjs';

function glb(json, padTo = 0) {
  const text = Buffer.from(JSON.stringify(json));
  const chunk = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(20);

  header.write('glTF', 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + chunk.length, 8);
  header.writeUInt32LE(chunk.length, 12);
  header.write('JSON', 16);

  const bytes = Buffer.concat([header, chunk]);

  return padTo > bytes.length ? Buffer.concat([bytes, Buffer.alloc(padTo - bytes.length)]) : bytes;
}

const env = {
  SKU3D_SERVER_URL: PRODUCTION_SERVER_URL,
  SKU3D_TENANT_ID: 't',
  SKU3D_WORKER_KEY: 'k',
  SKU3D_WORK_ROOT: '/w',
  CODEX_BIN: '/c',
  BLENDER_PATH: '/b',
  GLTF_TRANSFORM_CLI: '/g',
  GLTF_VALIDATOR_MODULE: '/v',
  EDGE_BIN: '/e',
  SKU3D_CODEX_HOME: '/h',
  SKU3D_DENY_READ: '/cfg;/other',
};

test('childEnv drops worker key, server url and tenant, keeps Windows Path', () => {
  const out = childEnv({ ...env, Path: 'C:/bin', USERPROFILE: 'C:/Users/hello', BLENDER_PATH: '/b' });

  assert.deepEqual(Object.keys(out).sort(), ['BLENDER_PATH', 'GLTF_TRANSFORM_CLI', 'Path', 'USERPROFILE']);
});

test('loadConfig reports empty settings and missing files', () => {
  assert.throws(() => loadConfig({}), /설정이 비어 있어요/);
  assert.throws(() => loadConfig(env, () => false), /경로에 파일이 없어요/);
  assert.equal(loadConfig(env, () => true).devConnection, false);
  assert.equal(loadConfig({ ...env, SKU3D_SERVER_URL: 'https://x.trycloudflare.com' }, () => true).devConnection, true);
  assert.throws(() => loadConfig({ ...env, SKU3D_SERVER_URL: 'http://core.example' }, () => true), /https/);
});

test('codexArgs never uses --last or --ephemeral and resumes the exact session', () => {
  const base = { workdir: '/w', schemaPath: '/w/s.json', lastMessagePath: '/w/i/review.json', images: ['/w/p.jpg'] };
  const first = codexArgs({ ...base, sessionId: null });
  const resume = codexArgs({ ...base, sessionId: '019a-session' });

  for (const args of [first, resume]) {
    assert.ok(!args.includes('--last'));
    assert.ok(!args.includes('--ephemeral'));
    assert.equal(args.at(-1), '-');
  }

  assert.equal(first.at(-2), '--');

  assert.deepEqual(first.slice(0, 1), ['exec']);
  assert.ok(first.includes('-i'));
  assert.deepEqual(resume.slice(0, 2), ['exec', 'resume']);
  assert.equal(resume.at(-2), '019a-session');
  assert.ok(!resume.includes('-i'));
});

test('codexArgs separates variadic image paths from the stdin prompt', () => {
  const base = { workdir: 'C:/jobs/w', schemaPath: 'C:/jobs/w/s.json', lastMessagePath: 'C:/jobs/w/i/review.json' };

  for (const images of [[], ['C:/jobs/w/inputs/photos/01 a.jpg'], ['a.jpg', 'b.png', 'c.webp']]) {
    const args = codexArgs({ ...base, sessionId: null, images });

    assert.deepEqual(args.slice(-2), ['--', '-']);
    assert.equal(args.filter((a) => a === '-i').length, images.length);

    for (const image of images) {
      assert.equal(args[args.indexOf(image) - 1], '-i');
    }
  }
});

test('readCodexEvent picks session and progress lines', () => {
  assert.deepEqual(readCodexEvent('{"type":"thread.started","thread_id":"abc"}'), { kind: 'session', sessionId: 'abc' });
  assert.equal(readCodexEvent('{"type":"item.completed","item":{"type":"agent_message","text":"렌더 비교 중"}}').kind, 'progress');
  assert.equal(readCodexEvent('not json'), null);
});

test('runCodex passes the prompt through stdin untouched (no shell)', async () => {
  const fake = join(mkdtempSync(join(tmpdir(), 'fake-codex-')), 'codex.mjs');
  const prompt = '뚜껑을 둥글게 해줘 & del C:\\* | rm -rf / "$(whoami)"';
  const events = [];

  writeFileSync(
    fake,
    `let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{console.log(JSON.stringify({type:'thread.started',thread_id:'t-1'}));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:s}}));});`,
  );

  const result = await runCodex({
    bin: process.execPath,
    args: [fake],
    cwd: tmpdir(),
    env: { PATH: process.env.PATH },
    prompt,
    timeoutMs: 10_000,
    onEvent: (e) => events.push(e),
  });

  assert.equal(result.code, 0);
  assert.deepEqual(events[0], { kind: 'session', sessionId: 't-1' });
  assert.equal(events[1].body, prompt);
});

test('runCodex stops the child when the lease is lost', async () => {
  const abort = new AbortController();
  const started = Date.now();
  const pending = runCodex({
    bin: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000)'],
    cwd: tmpdir(),
    env: { PATH: process.env.PATH },
    prompt: '',
    timeoutMs: 60_000,
    onEvent: () => undefined,
    signal: abort.signal,
  });

  setTimeout(() => abort.abort(), 200);

  const result = await pending;

  assert.equal(result.aborted, true);
  assert.ok(Date.now() - started < 5_000);
});

test('judge rejects oversize glb and external uri', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'judge-'));

  writeFileSync(join(dir, 'model.glb'), glb({ asset: { version: '2.0' } }, GLB_MAX_BYTES + 4));
  assert.match((await judgeOutputs(dir, { validatorModule: '/none' })).reason, /바이트예요/);

  const gltf = { asset: { version: '2.0' }, images: [{ uri: 'label.png' }] };

  assert.deepEqual(externalUris(gltf), ['label.png']);
  writeFileSync(join(dir, 'model.glb'), glb(gltf));
  assert.match((await judgeOutputs(dir, { validatorModule: '/none' })).reason, /바깥 파일/);
});

test('judge requires renders and a complete review', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'judge-'));
  const validator = join(dir, 'validator.cjs');

  writeFileSync(
    validator,
    'exports.validateBytes = async () => ({ validatorVersion: "fake", issues: { numErrors: 0, numWarnings: 0, messages: [] } });',
  );
  writeFileSync(join(dir, 'model.glb'), glb({ asset: { version: '2.0' } }));
  assert.match((await judgeOutputs(dir, { validatorModule: validator })).reason, /렌더 이미지/);

  mkdirSync(join(dir, 'renders'));

  for (let i = 0; i < 6; i += 1) {
    writeFileSync(join(dir, 'renders', `${i}.png`), 'x');
  }

  writeFileSync(join(dir, 'review.json'), JSON.stringify({ summary: 's' }));
  assert.match((await judgeOutputs(dir, { validatorModule: validator })).reason, /빠진 칸/);
  assert.equal(glbJson(glb({ asset: { version: '2.0' } })).asset.version, '2.0');
  assert.match(reviewProblem({ summary: '', verdict: 'ok', issues: [], proposals: [], autoFixes: [], unseenFaces: [], assumptions: [], needsPhotos: [], dimensionsUsed: {} }), /verdict/);
});

test('viewer page matches the live viewer and reports its state', () => {
  const html = viewerHtml(Buffer.from('glb'));

  assert.ok(html.includes('camera-orbit="0deg 75deg 150%"'));
  assert.ok(html.includes('#c6c6c6'));
  assert.ok(html.includes('data:model/gltf-binary;base64,Z2xi'));
  assert.equal(viewerStateOf('<body data-viewer="visible">'), 'visible');
  assert.equal(viewerStateOf('<body>'), 'unknown');
});

test('api sends the key and tenant headers, lease token before the file, and maps 409', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });

    return url.endsWith('/heartbeat') ? new Response('lost', { status: 409 }) : Response.json({ fileId: 'f' });
  };
  const api = createApi({ serverUrl: 'https://s', tenantId: 't1', workerKey: 'key' }, fakeFetch);
  const file = join(mkdtempSync(join(tmpdir(), 'up-')), 'model.glb');

  writeFileSync(file, 'x');
  await api.upload({ id: 'j', leaseToken: 'L' }, file, 'model/gltf-binary');

  const form = calls[0].init.body;

  assert.equal(calls[0].init.headers.authorization, 'Bearer key');
  assert.equal(calls[0].init.headers['x-tenant-id'], 't1');
  assert.deepEqual([...form.keys()], ['leaseToken', 'file']);

  const error = await api.heartbeat({ id: 'j', leaseToken: 'L' }).catch((e) => e);

  assert.ok(error instanceof ApiError);
  assert.ok(isLeaseLost(error));
});

test('prompt points to the iteration folder and never embeds secrets', () => {
  const prompt = buildPrompt({ kind: 'revise', iteration: 3, photoPaths: ['inputs/photos/01.jpg'], base: { number: 2 } });

  assert.match(prompt, /iteration-3/);
  assert.match(prompt, /iteration-2/);
  assert.doesNotMatch(prompt, /SKU3D_WORKER_KEY|Bearer/);
});

test('runCodex does not run a child for an already aborted signal', async () => {
  const abort = new AbortController();
  const marker = join(mkdtempSync(join(tmpdir(), 'aborted-')), 'ran');

  abort.abort();

  const result = await runCodex({
    bin: process.execPath,
    args: ['-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x')`],
    cwd: tmpdir(),
    env: { PATH: process.env.PATH },
    prompt: '',
    timeoutMs: 10_000,
    onEvent: () => undefined,
    signal: abort.signal,
  });

  await new Promise((r) => setTimeout(r, 300));
  assert.equal(result.aborted, true);
  assert.throws(() => readFileSync(marker));
});

test('photo extension follows the bytes', () => {
  assert.equal(imageExtOf(Buffer.from('89504e470d0a1a0a', 'hex')), '.png');
  assert.equal(imageExtOf(Buffer.from('RIFF0000WEBPVP8 ')), '.webp');
  assert.equal(imageExtOf(Buffer.from('ffd8ffe0', 'hex')), '.jpg');
});

test('viewer screenshot comes from the same page as the verdict', () => {
  const dom = '<body data-viewer="visible" data-shot="data:image/png;base64,aGk=">';

  assert.equal(viewerShotOf(dom).toString(), 'hi');
  assert.equal(viewerShotOf('<body data-viewer="error" data-shot="">'), null);
});

function fakeApi(overrides = {}) {
  const calls = [];
  const api = {
    calls,
    heartbeat: async () => calls.push('heartbeat'),
    inputs: async () => {
      calls.push('inputs');
      throw new Error('네트워크 끊김');
    },
    events: async () => calls.push('events'),
    fail: async (_job, error, retryable) => calls.push(['fail', error, retryable]),
    complete: async () => calls.push('complete'),
    ...overrides,
  };

  return api;
}

const jobConfig = () => ({
  workRoot: mkdtempSync(join(tmpdir(), 'jobs-')),
  codexBin: process.execPath,
  jobTimeoutMs: 10_000,
});

test('an input failure is reported as a retryable failure and never crashes the loop', async () => {
  const api = fakeApi();

  await runJob({ id: 'j', workshopId: 'w', kind: 'create' }, { api, config: jobConfig(), tools: {}, signal: new AbortController().signal });

  assert.deepEqual(api.calls.at(-1), ['fail', '네트워크 끊김', true]);
  assert.ok(!api.calls.includes('complete'));
});

test('a stopped worker drops the job without reporting success or failure', async () => {
  const stop = new AbortController();
  const api = fakeApi({
    inputs: async () => {
      stop.abort();

      return { iteration: 1, sku: {}, photos: [{ fileId: 'p', sortOrder: 1 }], request: '', base: null, sessionId: null };
    },
    download: async () => Buffer.from('ffd8', 'hex'),
  });

  await runJob({ id: 'j', workshopId: 'w', kind: 'create' }, { api, config: jobConfig(), tools: {}, signal: stop.signal });

  assert.ok(!api.calls.includes('complete'));
  assert.ok(!api.calls.some((c) => Array.isArray(c) && c[0] === 'fail'));
});

test('changeLines tells Codex what changed since the base version', () => {
  const lines = changeLines({
    addedPhotos: ['p-new'],
    removedPhotos: ['p-old'],
    dimensions: {
      before: { packageWidthMm: 62, packageLengthMm: 36, packageHeightMm: 160, packageWeightG: 180, dimensionBasis: 'package' },
      after: { packageWidthMm: 62, packageLengthMm: 36, packageHeightMm: 150, packageWeightG: 180, dimensionBasis: 'body' },
    },
  }).join('\n');

  assert.match(lines, /새로 추가된 사진 1장.*p-new/);
  assert.match(lines, /지운 사진 1장/);
  assert.match(lines, /160mm.*→.*150mm/);
});

test('finishedFor matches only the same kind and request', () => {
  const dir = mkdtempSync(join(tmpdir(), 'done-'));

  writeFileSync(join(dir, DONE_MARKER), JSON.stringify({ kind: 'revise', request: '뚜껑을 둥글게' }));
  assert.equal(finishedFor(dir, { kind: 'revise' }, '뚜껑을 둥글게'), true);
  assert.equal(finishedFor(dir, { kind: 'revise' }, '다른 요청'), false);
  assert.equal(finishedFor(dir, { kind: 'create' }, '뚜껑을 둥글게'), false);
  assert.equal(finishedFor(mkdtempSync(join(tmpdir(), 'none-')), { kind: 'create' }, ''), false);
});

test('hasSharp is false when sharp is not next to gltf-transform', () => {
  assert.equal(hasSharp(join(mkdtempSync(join(tmpdir(), 'gt-')), 'cli.js')), false);
});

// 이미 끝난 결과가 있는 재시도: Codex 를 부르면 표시 파일이 생기는 가짜 Codex 로 확인한다
function retrySetup({ valid }) {
  const workRoot = mkdtempSync(join(tmpdir(), 'reuse-'));
  const iterDir = join(workRoot, 'w', 'iteration-1');
  const codexRan = join(workRoot, 'codex-ran');
  const fakeCodex = join(workRoot, 'codex.mjs');
  const validator = join(workRoot, 'validator.cjs');

  mkdirSync(join(iterDir, 'renders'), { recursive: true });
  writeFileSync(fakeCodex, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(codexRan)}, 'x');`);
  writeFileSync(validator, 'exports.validateBytes = async () => ({ validatorVersion: "fake", issues: { numErrors: 0, numWarnings: 0, messages: [] } });');
  writeFileSync(join(iterDir, 'model.glb'), valid ? glb({ asset: { version: '2.0' } }) : Buffer.from('not a glb'));

  for (let i = 0; i < 6; i += 1) {
    writeFileSync(join(iterDir, 'renders', `${i}.png`), 'x');
  }

  writeFileSync(
    join(iterDir, 'review.json'),
    JSON.stringify({ summary: 's', verdict: 'ready_for_review', issues: [], proposals: [], autoFixes: [], unseenFaces: [], assumptions: [], needsPhotos: [], dimensionsUsed: { widthMm: 1, lengthMm: 1, heightMm: 1, basis: 'package' } }),
  );
  writeFileSync(join(iterDir, DONE_MARKER), JSON.stringify({ kind: 'create', request: '' }));

  const before = readFileSync(join(iterDir, 'model.glb'));
  const calls = [];
  const api = {
    heartbeat: async () => undefined,
    events: async () => undefined,
    inputs: async () => ({ iteration: 1, sku: {}, photos: [], request: '', base: null, changes: null, sessionId: 's-1' }),
    download: async () => Buffer.alloc(0),
    upload: async (_job, path) => {
      calls.push(['upload', path.split(/[\\/]/).pop()]);

      return { fileId: `f-${calls.length}` };
    },
    complete: async () => calls.push(['complete']),
    fail: async (_job, error, retryable) => calls.push(['fail', error, retryable]),
  };
  const config = {
    workRoot,
    codexBin: process.execPath,
    jobTimeoutMs: 10_000,
    gltfValidatorModule: validator,
    edgeBin: join(workRoot, 'no-edge.exe'),
  };

  return { api, config, calls, codexRan, iterDir, before, fakeCodex };
}

test('a retry with finished outputs only validates and uploads — Codex is not called and files stay', async () => {
  const s = retrySetup({ valid: true });

  await runJob({ id: 'j', workshopId: 'w', kind: 'create' }, { api: s.api, config: { ...s.config, codexBin: s.fakeCodex }, tools: {}, signal: new AbortController().signal });

  assert.throws(() => readFileSync(s.codexRan));
  assert.ok(s.calls.some((c) => c[0] === 'complete'));
  assert.ok(s.calls.some((c) => c[0] === 'upload' && c[1] === 'model.glb'));
  assert.deepEqual(readFileSync(join(s.iterDir, 'model.glb')), s.before);
});

test('a retry whose finished outputs fail validation stops without calling Codex', async () => {
  const s = retrySetup({ valid: false });

  await runJob({ id: 'j', workshopId: 'w', kind: 'create' }, { api: s.api, config: { ...s.config, codexBin: s.fakeCodex }, tools: {}, signal: new AbortController().signal });

  assert.throws(() => readFileSync(s.codexRan));
  assert.ok(!s.calls.some((c) => c[0] === 'complete'));

  const failed = s.calls.find((c) => c[0] === 'fail');

  assert.match(failed[1], /검증을 통과하지 못했어요/);
  assert.equal(failed[2], false);
  assert.deepEqual(readFileSync(join(s.iterDir, 'model.glb')), s.before);
});

test('loadConfig reads the dedicated Codex home and deny list', () => {
  const config = loadConfig(env, () => true);

  assert.equal(config.codexHome, '/h');
  assert.deepEqual(config.denyRead, ['/cfg', '/other']);
  assert.equal(config.windowsSandbox, 'mxc');
  assert.throws(() => loadConfig({ ...env, SKU3D_DENY_READ: '' }, () => true), /SKU3D_DENY_READ/);
});

test('codexArgs leaves the sandbox to the permission profile (no sandbox_mode)', () => {
  const base = { workdir: '/w', schemaPath: '/s', lastMessagePath: '/r', images: [] };

  for (const args of [codexArgs({ ...base, sessionId: null }), codexArgs({ ...base, sessionId: 's-1' })]) {
    assert.ok(!args.some((a) => a.includes('sandbox_mode')));
  }
});

test('sandbox config writes only the workshop, denies secrets and turns the network off', () => {
  const toml = sandboxConfigToml({
    writeDir: 'C:\\jobs\\w1',
    readPaths: ['C:\\Blender'],
    denyPaths: ['C:\\cfg', 'C:\\jobs\\w2'],
    windowsSandbox: 'mxc',
  });

  assert.match(toml, /default_permissions = "sku3d-job"/);
  assert.match(toml, /sandbox = "mxc"/);
  assert.match(toml, /':minimal' = "read"/);
  assert.match(toml, /'C:\/Blender' = "read"/);
  assert.match(toml, /'C:\/jobs\/w1' = "write"/);
  assert.match(toml, /'C:\/cfg' = "deny"/);
  assert.match(toml, /'C:\/jobs\/w2' = "deny"/);
  assert.ok(!toml.includes('\\'));
  assert.match(toml, /\[permissions\.sku3d-job\.network\]\nenabled = false/);
  assert.doesNotMatch(toml, /sandbox_mode/);
  assert.throws(() => sandboxConfigToml({ writeDir: "C:\\it's", denyPaths: [], windowsSandbox: 'mxc' }));
});

test('deny list covers other workshops, secrets and Codex homes but not the current workshop', () => {
  const root = mkdtempSync(join(tmpdir(), 'deny-'));

  for (const name of ['w1', 'w2', 'w3']) {
    mkdirSync(join(root, name));
  }

  const deny = denyPathsFor({ workRoot: root, workshopDir: join(root, 'w1'), denyRead: ['/cfg'], codexHome: '/h', userCodexHome: '/u/.codex' });

  // Windows 에서는 /cfg 가 C:\\cfg 로 정규화된다 — 같은 resolve 로 비교한다
  assert.ok(!deny.includes(resolve(root, 'w1')));
  assert.ok(deny.includes(resolve(root, 'w2')) && deny.includes(resolve(root, 'w3')));
  assert.ok(deny.includes(resolve('/cfg')) && deny.includes(resolve('/h')) && deny.includes(resolve('/u/.codex')));
});

test('probes print only a verdict, never file contents', () => {
  const [bin, ...args] = probeScript('read', "C:\\cfg\\worker-key.env", 'win32');

  assert.equal(bin, 'powershell.exe');
  assert.match(args.at(-1), /OpenRead/);
  assert.doesNotMatch(args.at(-1), /Get-Content|ReadAllText/);
  assert.equal(probeVerdict('PROBE_DENIED'), 'denied');
  assert.equal(probeVerdict('noise PROBE_ALLOWED'), 'allowed');
  assert.equal(probeVerdict(''), 'error');
  assert.equal(probeVerdict('error: the following required arguments were not provided'), 'error');
});

test('sandbox probe names the job profile and working dir explicitly', () => {
  assert.deepEqual(sandboxArgs('C:\\jobs\\w1', ['powershell.exe', '-c', 'x']), [
    'sandbox', '-P', 'sku3d-job', '-C', 'C:\\jobs\\w1', '--', 'powershell.exe', '-c', 'x',
  ]);
});

test('tool read paths open the install folders, and the whole node_modules for gltf-transform', () => {
  const paths = toolReadPaths({
    blenderPath: '/opt/blender/blender',
    nodeBin: '/opt/node/bin/node',
    gltfTransformCli: '/opt/tools/node_modules/@gltf-transform/cli/bin/cli.js',
  });

  assert.deepEqual(paths, [resolve('/opt/blender'), resolve('/opt/node/bin'), resolve('/opt/tools/node_modules')]);
});

test('profile paths use forward slashes even for Windows paths', () => {
  assert.equal(profilePath('C:\\Users\\hello\\jobs\\w1'), 'C:/Users/hello/jobs/w1');
  assert.equal(profilePath('/already/posix'), '/already/posix');
});
