#!/usr/bin/env node
// 아몬드영 3D 작업실 홈 PC 워커. 서버에 HTTPS 로 접속해 작업을 가져가고, Codex CLI + Blender 로 만든 결과를 올린다.
// 실행: node --env-file=worker.env --env-file=worker-key.env worker.mjs
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import { createApi, isLeaseLost } from './api.mjs';
import { codexArgs, runCodex } from './codex-run.mjs';
import { childEnv, loadConfig } from './env.mjs';
import { judgeOutputs } from './judge.mjs';
import { viewerCheck } from './viewer-check.mjs';
import { denyPathsFor, isolationCheck, writeSandboxConfig } from './isolation.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HEARTBEAT_MS = 30_000;
const EVENT_FLUSH_MS = 5_000;
const JUDGE_FIX_TURNS = 1;

const MIME = { '.glb': 'model/gltf-binary', '.png': 'image/png', '.py': 'text/plain', '.md': 'text/markdown', '.blend': 'application/x-blender' };

export function buildPrompt({ kind, iteration, photoPaths, base, changes }) {
  const lines = [
    '이 폴더의 AGENTS.md 지시를 처음부터 끝까지 따른다.',
    `이번 산출물 폴더는 iteration-${iteration} 이다. 모든 산출물을 그 안에 둔다.`,
    '상품 정보는 inputs/product.json, 원본 사진은 아래 경로다(수정 금지).',
    ...photoPaths.map((p) => `- ${p}`),
  ];

  if (kind === 'revise') {
    lines.push(
      `작업자 수정 요청은 iteration-${iteration}/request.md 에 있다.`,
      base ? `기준 버전은 iteration-${base.number} 이다. 그 버전을 고쳐 새 버전을 만든다(덮어쓰지 않는다).` : '',
    );
  } else {
    lines.push('첫 제작이다.');
  }

  if (changes) {
    lines.push(...changeLines(changes));
  }

  lines.push('마지막 응답은 review.schema.json 형식의 JSON 하나로만 끝낸다.');

  return lines.filter(Boolean).join('\n');
}

// 기준 버전을 만든 뒤 바뀐 실측 자료를 Codex 에게 알린다
export function changeLines(changes) {
  const lines = ['기준 버전을 만든 뒤 실측 자료가 바뀌었다. 바뀐 자료에 맞춰 다시 맞춘다.'];

  if (changes.addedPhotos.length > 0) {
    lines.push(`- 새로 추가된 사진 ${changes.addedPhotos.length}장: 위 사진 목록에서 파일 이름에 이 id 가 든 것 (${changes.addedPhotos.join(', ')})`);
  }

  if (changes.removedPhotos.length > 0) {
    lines.push(`- 지운 사진 ${changes.removedPhotos.length}장: 더 이상 쓰지 않는다(inputs/removed-photos 로 옮겼다)`);
  }

  if (changes.dimensions) {
    const fmt = (d) => `${d.packageWidthMm}×${d.packageLengthMm}×${d.packageHeightMm}mm ${d.packageWeightG}g (기준 ${d.dimensionBasis})`;

    lines.push(`- 치수: ${fmt(changes.dimensions.before)} → ${fmt(changes.dimensions.after)}`);
  }

  return lines;
}

// Codex 가 이 요청으로 끝냈다는 표시. 같은 요청의 재시도면 Codex 를 다시 부르지 않고 검증·업로드만 한다
export const DONE_MARKER = '.codex-done.json';

export function finishedFor(iterDir, job, request) {
  const path = join(iterDir, DONE_MARKER);

  if (!existsSync(path)) {
    return false;
  }

  try {
    const marker = JSON.parse(readFileSync(path, 'utf8'));

    return marker.kind === job.kind && marker.request === (request ?? '');
  } catch {
    return false;
  }
}

// gltf-transform 이 텍스처를 변환하려면 같은 설치에 sharp 가 있어야 한다
export function hasSharp(gltfTransformCli) {
  try {
    createRequire(gltfTransformCli).resolve('sharp');

    return true;
  } catch {
    return false;
  }
}

function toolVersions(config) {
  // 버전 조회도 걸러낸 환경으로만 — 워커 키가 Codex 에 닿지 않게
  const env = childEnv(process.env);
  const first = (bin, args) => {
    try {
      return execFileSync(bin, args, { encoding: 'utf8', windowsHide: true, timeout: 60_000, env })
        .split(/\r?\n/)[0]
        .trim();
    } catch (error) {
      return `확인 실패: ${String(error).slice(0, 100)}`;
    }
  };

  return {
    worker: config.hostId,
    node: process.version,
    codex: first(config.codexBin, ['--version']),
    blender: first(config.blenderPath, ['--version']),
    gltfTransform: first(config.nodeBin, [config.gltfTransformCli, '--version']),
  };
}

async function prepareFolder(api, job, inputs, config, assertLive) {
  const workshopDir = join(config.workRoot, job.workshopId);
  const iterDir = join(workshopDir, `iteration-${inputs.iteration}`);
  const photosDir = join(workshopDir, 'inputs', 'photos');

  mkdirSync(join(iterDir, 'renders'), { recursive: true });
  mkdirSync(photosDir, { recursive: true });
  copyFileSync(join(HERE, 'prompts', 'AGENTS.md'), join(workshopDir, 'AGENTS.md'));
  copyFileSync(join(HERE, 'review.schema.json'), join(workshopDir, 'review.schema.json'));
  writeFileSync(join(workshopDir, 'inputs', 'product.json'), JSON.stringify(inputs.sku, null, 2));
  writeFileSync(join(iterDir, 'request.md'), inputs.request ?? '');

  // 지금 사진 목록에 없는 사진은 치운다 — 지운 사진이 폴더에 남으면 Codex 가 헷갈린다
  const current = new Set(inputs.photos.map((p) => p.fileId));
  const removedDir = join(workshopDir, 'inputs', 'removed-photos');

  for (const name of readdirSync(photosDir)) {
    const fileId = /^\d+-([0-9a-f-]{36})\./.exec(name)?.[1];

    if (fileId && !current.has(fileId)) {
      mkdirSync(removedDir, { recursive: true });
      renameSync(join(photosDir, name), join(removedDir, name));
    }
  }

  const photoPaths = [];

  for (const photo of inputs.photos) {
    const stem = join(photosDir, `${String(photo.sortOrder).padStart(2, '0')}-${photo.fileId}`);
    const known = ['.jpg', '.png', '.webp'].map((ext) => stem + ext).find((path) => existsSync(path));
    let path = known;

    if (!path) {
      assertLive();

      const bytes = await api.download(job, photo.fileId);

      path = stem + imageExtOf(bytes);
      writeFileSync(path, bytes);
    }

    photoPaths.push(path);
  }

  // 이 PC 에 기준 버전 폴더가 없으면(재설치 등) 서버에서 받아 둔다
  if (inputs.base) {
    const baseDir = join(workshopDir, `iteration-${inputs.base.number}`);

    for (const [name, fileId] of Object.entries(inputs.base.files)) {
      const path = join(baseDir, name);

      if (!existsSync(path)) {
        assertLive();
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, await api.download(job, fileId));
      }
    }
  }

  return { workshopDir, iterDir, photoPaths };
}

function eventSink(api, job) {
  let pending = [];

  const flush = async () => {
    if (pending.length === 0) {
      return;
    }

    const items = pending.slice(0, 20);

    pending = pending.slice(20);
    await api.events(job, items);
  };

  return { push: (item) => pending.push(item), flush };
}

async function uploadAll(api, job, iterDir, judged, viewerShot, assertLive) {
  const upload = async (path) => {
    assertLive();

    return (await api.upload(job, path, MIME[path.slice(path.lastIndexOf('.'))] ?? 'application/octet-stream')).fileId;
  };
  const optional = async (name) => (existsSync(join(iterDir, name)) ? upload(join(iterDir, name)) : undefined);
  const renderFileIds = [];

  for (const path of viewerShot ? [...judged.renders, viewerShot] : judged.renders) {
    renderFileIds.push(await upload(path));
  }

  return {
    glbFileId: await upload(judged.glbPath),
    renderFileIds,
    pythonFileId: await optional('build.py'),
    blendFileId: await optional('model.blend'),
    planFileId: await optional('plan.md'),
  };
}

export function imageExtOf(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    return '.png';
  }

  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    return '.webp';
  }

  return '.jpg';
}

const abandoned = (message) => Object.assign(new Error(message), { abandoned: true });

export async function runJob(job, { api, config, tools, signal }) {
  const abort = new AbortController();
  let leaseLost = false;
  const stopIfAborted = () => abort.abort();

  signal.addEventListener('abort', stopIfAborted);

  // 단계마다 확인한다 — 멈췄거나 lease 를 잃었으면 다음 단계로 가지 않는다
  const assertLive = () => {
    if (abort.signal.aborted) {
      throw abandoned(leaseLost ? 'lease 를 잃었어요' : '워커가 멈췄어요');
    }
  };
  const loseLease = (error) => {
    if (isLeaseLost(error)) {
      leaseLost = true;
      abort.abort();
    }
  };
  // claim 직후부터 lease 를 붙잡는다 — 입력·사진 받는 동안에도
  const beat = setInterval(() => api.heartbeat(job).catch(loseLease), HEARTBEAT_MS);
  const events = eventSink(api, job);
  const flusher = setInterval(() => events.flush().catch(loseLease), EVENT_FLUSH_MS);

  try {
    const inputs = await api.inputs(job);
    const { workshopDir, iterDir, photoPaths } = await prepareFolder(api, job, inputs, config, assertLive);
    let sessionId = inputs.sessionId;
    let sessionSaved = Promise.resolve();

    const turn = async (prompt, images) => {
      assertLive();
      // 이번 작업실만 쓰고 다른 작업실·설정·키·로그인 정보는 읽지 못하게, 네트워크는 끄고
      writeSandboxConfig(config.codexHome, {
        writeDir: workshopDir,
        denyPaths: denyPathsFor({
          workRoot: config.workRoot,
          workshopDir,
          denyRead: config.denyRead,
          codexHome: config.codexHome,
          userCodexHome: config.userCodexHome,
        }),
        windowsSandbox: config.windowsSandbox,
      });

      const result = await runCodex({
        bin: config.codexBin,
        args: codexArgs({
          sessionId,
          workdir: workshopDir,
          schemaPath: join(workshopDir, 'review.schema.json'),
          lastMessagePath: join(iterDir, 'review.json'),
          images,
        }),
        cwd: workshopDir,
        env: {
          ...childEnv(process.env),
          CODEX_HOME: config.codexHome,
          BLENDER_PATH: config.blenderPath,
          NODE_BIN: config.nodeBin,
          GLTF_TRANSFORM_CLI: config.gltfTransformCli,
        },
        prompt,
        timeoutMs: config.jobTimeoutMs,
        signal: abort.signal,
        onEvent: (event) => {
          if (event.kind === 'session' && !sessionId) {
            sessionId = event.sessionId;
            // 받자마자 서버에 적는다 — 여기서 PC 가 꺼져도 다음 시도가 이 세션을 잇는다
            sessionSaved = saveSession(api, job, sessionId);
            sessionSaved.catch(loseLease);
          }

          if (event.kind === 'progress' || event.kind === 'error') {
            events.push({ type: 'progress', body: event.body });
          }
        },
      });

      if (result.aborted) {
        assertLive();
      }

      // 세션 id 가 서버에 남지 않으면 다음 수정이 새 세션으로 시작된다 — 성공으로 넘어가지 않는다
      await sessionSaved;

      if (result.timedOut) {
        throw Object.assign(new Error('제한 시간 안에 끝나지 않았어요'), { retryable: true });
      }

      if (result.code !== 0) {
        throw Object.assign(new Error(`Codex 가 ${result.code} 로 끝났어요: ${result.stderr.slice(-500)}`), {
          retryable: true,
        });
      }

      writeFileSync(
        join(iterDir, DONE_MARKER),
        JSON.stringify({ jobId: job.id, kind: job.kind, request: inputs.request ?? '', at: new Date().toISOString() }),
      );
    };
    const check = async () => {
      assertLive();

      const judged = await judgeOutputs(iterDir, { validatorModule: config.gltfValidatorModule });

      if (!judged.ok) {
        return { judged, viewer: null };
      }

      assertLive();

      const viewer = await viewerCheck({
        edgeBin: config.edgeBin,
        glbPath: judged.glbPath,
        outDir: join(iterDir, 'viewer'),
        signal: abort.signal,
      }).catch((error) => {
        assertLive();

        // 검사 도구가 실패한 걸 모델 오류로 보지 않는다 — Codex 를 다시 돌리지 않고, 확인 못 했다고 남긴 채 올린다.
        // 공개는 작업자가 휴대전화의 실제 웹 뷰어로 보고 승인해야만 된다
        const reason = String(error.message ?? error).slice(0, 400);

        events.push({ type: 'status', body: `웹 뷰어 자동 확인을 못 했어요. 화면에서 직접 확인해 주세요 (${reason.slice(0, 200)})` });

        return { ok: true, unverified: true, state: `확인 못 함: ${reason}`, screenshot: null };
      });

      return { judged, viewer };
    };

    const reuse = finishedFor(iterDir, job, inputs.request);

    if (reuse) {
      // 재시도인데 Codex 는 이미 이 요청으로 끝냈다 — Codex·Blender 를 다시 부르지 않고 있는 파일을 검증해 올린다
      events.push({ type: 'status', body: '이미 만든 결과를 검증해서 다시 올려요. Codex 는 다시 돌리지 않아요' });
    } else {
      events.push({ type: 'status', body: sessionId ? '같은 Codex 세션으로 고치기 시작했어요' : 'Codex 가 만들기 시작했어요' });
      await turn(
        buildPrompt({
          kind: job.kind,
          iteration: inputs.iteration,
          photoPaths: photoPaths.map((p) => relative(workshopDir, p)),
          base: inputs.base,
          changes: inputs.changes,
        }),
        sessionId ? [] : photoPaths,
      );
    }

    let { judged, viewer } = await check();

    if (reuse && !judged.ok) {
      // 검증·업로드 재시도에서는 Codex 로 넘어가지 않는다 — 이유를 남기고 멈춘다
      throw Object.assign(new Error(`이미 만든 결과가 검증을 통과하지 못했어요: ${judged.reason}`), { retryable: false });
    }

    // 명확한 제작 오류는 같은 세션에 한 번 더 고치게 한다 — 그래도 안 되면 실패로 남긴다
    for (let fix = 0; !reuse && fix < JUDGE_FIX_TURNS && !(judged.ok && viewer?.ok); fix += 1) {
      const reason = judged.ok ? `웹 뷰어(model-viewer)에서 모델이 보이지 않아요(상태: ${viewer?.state})` : judged.reason;

      events.push({ type: 'status', body: `자동 검사에서 걸려서 다시 고쳐요: ${reason.slice(0, 300)}` });
      await turn(
        `워커 자동 검사에서 실패했다: ${reason}\niteration-${inputs.iteration} 의 산출물을 고치고 마지막 응답을 review JSON 으로 다시 낸다.`,
        [],
      );
      ({ judged, viewer } = await check());
    }

    if (!judged.ok || !viewer?.ok) {
      throw Object.assign(new Error(judged.ok ? `웹 뷰어에서 모델이 보이지 않아요(${viewer?.state})` : judged.reason), {
        retryable: false,
      });
    }

    events.push({ type: 'status', body: '자동 검사를 통과했어요. 올리고 있어요' });
    await events.flush();

    const files = await uploadAll(api, job, iterDir, judged, viewer.screenshot, assertLive);

    assertLive();
    await api.complete(job, {
      ...files,
      review: judged.review,
      provenance: {
        tools,
        validator: judged.validation,
        glbBytes: judged.bytes,
        viewer: viewer.state,
        iteration: inputs.iteration,
      },
    });
    console.log(`[${job.id}] v${inputs.iteration} 완료`);
  } catch (error) {
    if (isLeaseLost(error) || error.abandoned) {
      console.warn(`[${job.id}] 작업을 내려놓았어요: ${error.message}`);

      return;
    }

    console.error(`[${job.id}] 실패: ${error.message}`);
    await events.flush().catch(() => undefined);
    await api.fail(job, error.message, error.retryable !== false).catch(() => undefined);
  } finally {
    clearInterval(beat);
    clearInterval(flusher);
    signal.removeEventListener('abort', stopIfAborted);
  }
}

async function saveSession(api, job, sessionId) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await api.session(job, sessionId);

      return;
    } catch (error) {
      if (isLeaseLost(error) || attempt >= 5) {
        throw error;
      }

      await sleep(2_000 * attempt);
    }
  }
}

function printIsolation(isolation) {
  console.log(`격리 검사 (${isolation.configPath})`);

  for (const r of isolation.results) {
    console.log(`  ${r.ok ? '통과' : '실패'}  ${r.name} — 기대 ${r.want}, 결과 ${r.got}${r.note ? ` (${r.note.slice(0, 200)})` : ''}`);
  }

  console.log(isolation.ok ? '격리 검사 통과' : '격리 검사 실패');
}

async function main() {
  const config = loadConfig(process.env);
  const api = createApi(config);
  const tools = toolVersions(config);
  const stop = new AbortController();
  const running = new Set();

  if (config.devConnection) {
    console.log(`임시 개발 연결: ${config.serverUrl}`);
  }

  // 격리를 확인하지 못하면 작업을 받지 않는다
  const isolation = await isolationCheck({
    codexBin: config.codexBin,
    codexHome: config.codexHome,
    workRoot: config.workRoot,
    denyRead: config.denyRead,
    userCodexHome: config.userCodexHome,
    windowsSandbox: config.windowsSandbox,
    env: childEnv(process.env),
  });

  printIsolation(isolation);

  if (process.argv.includes('--isolation-check')) {
    process.exit(isolation.ok ? 0 : 1);
  }

  if (!isolation.ok) {
    console.error('격리 검사를 통과하지 못해 작업을 받지 않아요. 위 결과를 저장소 담당자에게 전달해 주세요');
    process.exit(1);
  }

  console.log(`워커 ${config.hostId} 시작 — 동시 생성 ${config.concurrency}, 도구 ${JSON.stringify(tools)}`);

  if (!hasSharp(config.gltfTransformCli)) {
    console.warn('알림: gltf-transform 옆에 sharp 가 없어 텍스처 변환(--texture-compress webp)은 안 된다. 지시문은 Blender 로 WebP 를 내보내게 돼 있어 제작에는 지장 없다');
  }

  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      console.log('멈추는 중 — 진행 중 작업은 끝내지 않고 내려놓아요. 서버가 lease 가 끝나면 다시 맡겨요');
      stop.abort();
    });
  }

  while (!stop.signal.aborted) {
    if (running.size < config.concurrency) {
      try {
        const job = await api.claim();

        if (job) {
          console.log(`[${job.id}] ${job.kind} 작업을 가져왔어요(${job.attempts}번째)`);

          const task = runJob(job, { api, config, tools, signal: stop.signal })
            .catch((error) => console.error(`[${job.id}] 처리하지 못한 오류: ${error.message}`))
            .finally(() => running.delete(task));

          running.add(task);

          continue;
        }
      } catch (error) {
        console.error(`claim 실패: ${error.message}`);
      }
    }

    await sleep(config.pollMs, undefined, { signal: stop.signal }).catch(() => undefined);
  }

  await Promise.allSettled([...running]);
}

if (process.argv[1]?.endsWith('worker.mjs')) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

