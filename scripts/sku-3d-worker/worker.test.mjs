import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApiError, createApi, isLeaseLost } from './api.mjs';
import { codexArgs, readCodexEvent, runCodex } from './codex-run.mjs';
import { childEnv, loadConfig, PRODUCTION_SERVER_URL } from './env.mjs';
import { externalUris, GLB_MAX_BYTES, glbJson, judgeOutputs, reviewProblem } from './judge.mjs';
import { viewerHtml, viewerStateOf } from './viewer-check.mjs';
import { buildPrompt } from './worker.mjs';

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

  assert.deepEqual(first.slice(0, 1), ['exec']);
  assert.ok(first.includes('-i'));
  assert.deepEqual(resume.slice(0, 2), ['exec', 'resume']);
  assert.equal(resume.at(-2), '019a-session');
  assert.ok(!resume.includes('-i'));
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
