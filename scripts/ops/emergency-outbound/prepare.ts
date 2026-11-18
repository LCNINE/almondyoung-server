/**
 * 비상 출고 ① 아침 — `prepare` (#1249, 스펙 «① 아침»).
 *
 * 대상을 고르고, `--apply` 면 어드민 출고 준비 화면과 같은 순서로
 * 계획 확정 → 송장 일괄 발급 → 낱개 피킹 배치 생성 → 배치에 넣기 → 시작 까지 간다.
 * 단계마다 `run.json` 을 다시 써서, 중간에 죽으면 같은 `--run` 이 같은 멱등 키로 이어 간다.
 * 라벨·피킹 리스트·CSV 는 이 다음 단계(outputs)의 몫이다.
 */
import {
  BatchListItem,
  BulkShipmentResult,
  CoreApi,
  CoreApiError,
  PreparationBucketName,
  PreparationShipment,
  PreparationWaybillResult,
  WorkItem,
} from './core-api';
import { existsSync, readdirSync, statSync } from 'fs';
import { basename, dirname, join } from 'path';
import { produceOutputs } from './outputs';
import { readRun, RunBox, RunState, writeRun } from './run-state';
import { Route, selectTargets, Skipped, Target } from './select';

export interface PrepareReport {
  targets: Target[];
  skipped: Skipped[];
  /** dry-run 은 null */
  state: RunState | null;
  /** 라벨을 못 만든 상자 등 사람이 봐야 하는 문제 — 비어 있지 않으면 CLI 가 0 이 아닌 코드로 끝낸다. */
  problems: string[];
}

export interface PrepareOptions {
  warehouseId: string;
  run: string;
  dir: string;
  apply: boolean;
  /** 시작 뒤 라벨·피킹 리스트·CSV 를 만든다. 기본 true — 끄는 건 테스트뿐. */
  outputs?: boolean;
  log: (line: string) => void;
  /** 새로 쓴 CSV 이름의 시각. 기본 지금 — 테스트가 바꾼다. */
  now?: () => Date;
  /** 일시 실패 재시도 사이 기다리기. 기본 setTimeout — 테스트가 바꾼다. */
  sleep?: (ms: number) => Promise<void>;
}

/** 어드민 출고 준비 진행 창(outbound-preparation-runner.ts RETRY_DELAYS_MS)과 같은 간격 — 같은 키로 세 번까지 다시. */
const RETRY_DELAYS_MS = [2000, 5000, 10000] as const;
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const CHUNK = 100;
const MAX_START_RETRIES = 3;
const IDEMPOTENCY_MISMATCH = 'FULFILLMENT_IDEMPOTENCY_MISMATCH';
const BATCH_START_BLOCKED = 'BATCH_START_BLOCKED';
const VISIBLE_ASCII = /^[\x21-\x7e]+$/;

/**
 * `emergency:<실행>:<단계>:<id>`. 묶음 명령(plan·waybill·add)은 core 가 뒤에 `:<상자 id>` 를 붙여
 * 상자마다 키를 만들므로, 여기 id 는 실행·배치처럼 상자 묶음과 무관한 값을 쓴다 — 이어 돌릴 때 묶음이 달라져도 키가 같다.
 */
export function idemKey(run: string, step: string, id: string): string {
  const key = `emergency:${run}:${step}:${id}`;
  if (key.length > 200 || !VISIBLE_ASCII.test(key)) {
    throw new Error(
      `Idempotency-Key 로 쓸 수 없는 값이다(보이는 ASCII 33–126, 200자 이하): ${JSON.stringify(key.slice(0, 80))}`,
    );
  }
  return key;
}

export async function runPrepare(api: CoreApi, opts: PrepareOptions): Promise<PrepareReport> {
  const { warehouseId, run, dir, log } = opts;
  const prev = readRun(dir);
  if (prev && (prev.run !== run || prev.warehouseId !== warehouseId)) {
    throw new Error(
      `${dir}/run.json 은 실행 ${prev.run}(창고 ${prev.warehouseId})의 것이다 — --run ${run}·창고 ${warehouseId} 와 맞지 않는다`,
    );
  }
  if (prev?.finishedAt) {
    throw new Error(`실행 ${run} 은 저녁 dispatch 로 끝났다(${prev.finishedAt}) — 새 --run 으로 시작한다`);
  }

  const foreign = foreignRuns(dir);
  const input = await gather(api, warehouseId);
  const selected = selectTargets({
    ready: input.ready,
    resume: input.resume,
    otherBuckets: input.otherBuckets,
    batches: input.batches,
    ownBatchId: prev?.batchId ?? undefined,
    foreign,
  });
  const own = prev?.batchId ? input.batches.find((b) => b.batch.id === prev.batchId) : undefined;
  const ownBatch = own?.batch;
  const { targets, skipped } = narrow(selected, prev, ownBatch);
  const orderNos = new Map(
    [...input.ready, ...input.resume, ...input.otherBuckets.flatMap((b) => b.shipments)].map((s) => [
      s.shipmentId,
      s.orderNos,
    ]),
  );

  report(log, targets, skipped);
  const pending = pendingExcludes(prev, own);
  if (pending.length > 0) {
    log(
      `앞 실행에서 뺐다고 적었는데 배치 ${prev?.batchId}에 남은 상자 ${pending.length}` +
        (opts.apply ? ' — 배치에서 마저 뺀다' : ' — --apply 면 배치에서 마저 뺀다'),
    );
    for (const p of pending) log(`  - ${p.shipmentId} — ${p.reason}`);
  }

  if (!opts.apply) {
    if (targets.length === 0) log('대상 0 — 아무것도 바꾸지 않는다');
    log('dry-run — 아무것도 바꾸지 않았다. 실행하려면 --apply');
    return { targets, skipped, state: null, problems: [] };
  }

  try {
    // 대상이 0이어도 먼저 한다 — 안 하면 그 상자가 시작 안 된 배치에 묶여 출고 준비 화면에서도 사라진다.
    if (prev?.batchId) await finishPendingExcludes(api, prev.batchId, run, pending, log);
    if (targets.length === 0) {
      log(pending.length > 0 ? '대상 0 — 남은 빼기만 마쳤다' : '대상 0 — 아무것도 바꾸지 않는다');
      return { targets, skipped, state: prev, problems: [] };
    }
    const state = await apply(api, opts, prev, ownBatch, targets, orderNos);
    let problems: string[] = [];
    if (opts.outputs !== false) {
      // 이미 시작된 배치에서 이어받은 상자는 준비 목록에 없다 — 작업 항목의 주문번호로 채운다.
      const known = new Map(orderNos);
      for (const { workItems } of input.batches) {
        for (const w of workItems) {
          if (!known.has(w.shipmentId) && w.displayOrderNo) known.set(w.shipmentId, [w.displayOrderNo]);
        }
      }
      problems = await produceOutputs(api, state, known, dir, log, opts.now);
    }
    return { targets, skipped, state, problems };
  } catch (error) {
    if (error instanceof CoreApiError && error.code === IDEMPOTENCY_MISMATCH) throw mismatchError();
    throw error;
  }
}

// ── 읽기 ────────────────────────────────────────────────────────────

/**
 * 같은 뿌리(`.scratch/emergency-outbound/`) 아래 아직 안 끝난 다른 실행 폴더의 run.json — 그 실행이 만든 배치와
 * 그 실행이 맡은 상자 전부(배치에서 빠져 출고 준비 목록으로 돌아온 상자도 그 실행 몫이다).
 * 같은 날 두 번째 실행이 아침 실행의 못 보낸 상자를 다시 집으면 라벨이 두 장, 피킹 리스트가 두 벌이 된다.
 * 저녁 dispatch 가 끝난 실행(`finishedAt`)은 건너뛴다 — 그 실행이 못 보낸 상자는 다음 실행이나 정식 경로 몫이다.
 * 못 읽는 run.json 이 있으면 멈춘다 — 그 실행의 상자를 가릴 수 없다.
 */
function foreignRuns(dir: string): { batches: Map<string, string>; shipments: Map<string, string> } {
  const batches = new Map<string, string>();
  const shipments = new Map<string, string>();
  const root = dirname(dir);
  if (!existsSync(root)) return { batches, shipments };
  for (const name of readdirSync(root).sort()) {
    const sibling = join(root, name);
    if (name === basename(dir) || !statSync(sibling).isDirectory()) continue;
    if (!existsSync(join(sibling, 'run.json'))) continue;
    let state: RunState | null;
    try {
      state = readRun(sibling);
    } catch (error) {
      throw new Error(
        `다른 실행 폴더 ${name} 의 run.json 을 못 읽었다(${error instanceof Error ? error.message : String(error)}) — ` +
          '그 실행의 상자를 가릴 수 없어 멈춘다. 손으로 고쳤다면 되돌린다. 못 되돌리면 폴더는 그대로 두고 개발자에게',
      );
    }
    if (!state || state.finishedAt) continue;
    if (state.batchId) batches.set(state.batchId, state.run);
    for (const b of state.boxes) shipments.set(b.shipmentId, state.run);
  }
  return { batches, shipments };
}

interface Gathered {
  ready: PreparationShipment[];
  resume: PreparationShipment[];
  otherBuckets: { bucket: string; shipments: PreparationShipment[] }[];
  batches: { batch: BatchListItem; workItems: WorkItem[] }[];
}

/** 대상이 아닌 출고 준비 분류 — 상자마다 «빼고 사유 보고» 한다. */
const OTHER_BUCKETS: PreparationBucketName[] = ['partial', 'unavailable', 'mergeable', 'needs_info'];

async function gather(api: CoreApi, warehouseId: string): Promise<Gathered> {
  const ready = await pageBucket(api, warehouseId, 'ready');
  const resume = await pageBucket(api, warehouseId, 'resume');
  const otherBuckets: Gathered['otherBuckets'] = [];
  for (const bucket of OTHER_BUCKETS) {
    otherBuckets.push({ bucket, shipments: await pageBucket(api, warehouseId, bucket) });
  }

  const listed = [...(await api.batches(warehouseId, 'created')), ...(await api.batches(warehouseId, 'picking'))];
  const seen = new Set<string>();
  const batches: Gathered['batches'] = [];
  for (const batch of listed) {
    if (seen.has(batch.id)) continue;
    seen.add(batch.id);
    batches.push({ batch, workItems: await api.workItems(batch.id) });
  }

  return { ready, resume, otherBuckets, batches };
}

/** 출고 준비 응답은 요청한 분류만 상자를 싣고(200개씩) 나머지는 개수만 준다 — 분류마다 따로 끝까지 읽는다. */
async function pageBucket(
  api: CoreApi,
  warehouseId: string,
  bucket: PreparationBucketName,
): Promise<PreparationShipment[]> {
  const shipments: PreparationShipment[] = [];
  for (let offset = 0; ; ) {
    const res = await api.preparation(warehouseId, bucket, offset);
    const entry = res.buckets.find((b) => b.bucket === bucket);
    const page = entry?.shipments ?? [];
    shipments.push(...page);
    offset += page.length;
    if (page.length === 0 || offset >= (entry?.count ?? 0)) break;
  }
  return shipments;
}

/** 고른 대상에서 이 실행의 사정으로 뺄 것을 뺀다 — 이미 뺀 상자, 새 배치를 만들 수 없는 새 상자. */
function narrow(
  selected: { targets: Target[]; skipped: Skipped[] },
  prev: RunState | null,
  ownBatch: BatchListItem | undefined,
): { targets: Target[]; skipped: Skipped[] } {
  const targets: Target[] = [];
  const skipped = [...selected.skipped];
  const excludedBefore = new Map((prev?.excluded ?? []).map((e) => [e.shipmentId, e]));
  // 이 실행의 배치가 이미 시작됐거나 목록에서 사라졌으면 새 상자를 넣을 배치가 없다(같은 키로는 새 배치도 못 만든다).
  const noBatchForNew = !prev?.batchId
    ? null
    : !ownBatch
      ? `이 실행의 배치(${prev.batchId})가 시작 전·피킹 중 목록에 없음 — 새 상자는 새 --run 으로`
      : ownBatch.startedAt != null
        ? `이 실행의 배치(${prev.batchId})가 이미 시작됨 — 새 상자는 새 --run 으로`
        : null;

  for (const t of selected.targets) {
    const before = excludedBefore.get(t.shipmentId);
    if (before) {
      skipped.push({ ...before, reason: `이번 실행에서 이미 뺌 — ${before.reason}` });
    } else if (t.from !== 'batch' && noBatchForNew) {
      skipped.push({ shipmentId: t.shipmentId, reason: noBatchForNew });
    } else {
      targets.push(t);
    }
  }
  return { targets, skipped };
}

function report(log: (l: string) => void, targets: Target[], skipped: Skipped[]): void {
  const n = (p: (t: Target) => boolean) => targets.filter(p).length;
  log(
    `대상 ${targets.length} — 계획 확정부터 ${n((t) => t.from === 'draft')} · 송장부터 ${n((t) => t.from === 'planned')}` +
      ` · 배치 안 피킹 전 ${n((t) => t.from === 'batch' && t.route === 'location')}` +
      ` · 배치 안 포장 중 ${n((t) => t.from === 'batch' && t.route === 'force')}`,
  );
  if (skipped.length > 0) {
    log(`뺀 상자 ${skipped.length}`);
    for (const s of skipped)
      log(`  - ${s.shipmentId}${s.orderNos?.length ? ` (${s.orderNos.join(', ')})` : ''} — ${s.reason}`);
  }
}

// ── 쓰기 ────────────────────────────────────────────────────────────

async function apply(
  api: CoreApi,
  opts: PrepareOptions,
  prev: RunState | null,
  ownBatch: BatchListItem | undefined,
  targets: Target[],
  orderNos: Map<string, string[]>,
): Promise<RunState> {
  const { warehouseId, run, dir, log } = opts;
  const state: RunState = {
    run,
    warehouseId,
    batchId: prev?.batchId ?? null,
    boxes: [],
    excluded: [...(prev?.excluded ?? [])],
  };
  const save = () => writeRun(dir, state);
  const sleep = opts.sleep ?? defaultSleep;
  const prevBoxes = new Map((prev?.boxes ?? []).map((b) => [b.shipmentId, b]));
  const box = (shipmentId: string, batchId: string, route: Route): RunBox => {
    const p = prevBoxes.get(shipmentId);
    const same = p?.batchId === batchId;
    const nos = orderNos.get(shipmentId) ?? (same ? p.orderNos : undefined);
    return {
      shipmentId,
      route,
      batchId,
      trackingNo: same ? p.trackingNo : null,
      printed: same ? p.printed : false,
      ...(nos ? { orderNos: nos } : {}),
    };
  };
  const exclude = (shipmentId: string, reason: string) => {
    state.boxes = state.boxes.filter((b) => b.shipmentId !== shipmentId);
    if (state.excluded.some((e) => e.shipmentId === shipmentId)) return;
    const nos = orderNos.get(shipmentId);
    state.excluded.push(nos ? { shipmentId, reason, orderNos: nos } : { shipmentId, reason });
  };

  for (const t of targets) if (t.from === 'batch') state.boxes.push(box(t.shipmentId, t.batchId, t.route));
  save();

  // 1. 계획 확정(draft 만)
  const drafts = targets.filter((t) => t.from === 'draft').map((t) => t.shipmentId);
  const planned = targets.filter((t) => t.from === 'planned').map((t) => t.shipmentId);
  let toWaybill = planned;
  if (drafts.length > 0) {
    const ok = await bulk(drafts, (ids) => api.plan(ids, idemKey(run, 'plan', run)), '계획 확정', exclude, sleep);
    toWaybill = [...ok, ...planned];
    save();
    log(`계획 확정 ${ok.length}/${drafts.length}`);
  }

  // 2. 송장 일괄 발급(draft+planned) — 시작이 상자마다 발송 가능한 송장을 본다.
  // 일시 결과(transient·pending·time-budget-exceeded)는 같은 키로 다시 부른다 — core 가 활성 송장 행을 이어 간다.
  const toBatch: string[] = [];
  if (toWaybill.length > 0) {
    for (const chunk of chunks(toWaybill)) {
      let remaining = chunk;
      for (let retries = 0; ; retries++) {
        const results = new Map(
          (await api.issueWaybills(remaining, idemKey(run, 'waybill', run))).map((r) => [r.shipmentId, r]),
        );
        const again: string[] = [];
        for (const id of remaining) {
          const r = results.get(id);
          if (r?.code === IDEMPOTENCY_MISMATCH) throw mismatchError();
          if (!r) exclude(id, '비상 출고 — 송장 발급 응답에 없음');
          else if (r.status === 'registered') toBatch.push(id);
          else if (waybillRetryable(r) && retries < RETRY_DELAYS_MS.length) again.push(id);
          else {
            const tried = waybillRetryable(r) ? ` — ${retries}번 다시 시도해도 안 됨` : '';
            exclude(
              id,
              `비상 출고 — 송장 발급 안 됨: ${r.code ?? r.status}${r.reason ? ` (${r.reason})` : ''}${tried}`,
            );
          }
        }
        if (again.length === 0) break;
        log(`송장 발급 일시 실패 ${again.length} — ${RETRY_DELAYS_MS[retries] / 1000}초 뒤 같은 키로 다시`);
        await sleep(RETRY_DELAYS_MS[retries]);
        remaining = again;
      }
    }
    save();
    log(`송장 발급 ${toBatch.length}/${toWaybill.length}`);
  }

  // 3. 배치 생성(이 실행에 아직 없을 때만) → 4. 배치에 넣기
  let created = false;
  if (toBatch.length > 0) {
    if (!state.batchId) {
      const { batchId } = await api.createBatch(warehouseId, `비상 출고 ${run}`, idemKey(run, 'batch', run));
      state.batchId = batchId;
      created = true;
      save();
      log(`낱개 피킹 배치 만듦 ${batchId}`);
    }
    const batchId = state.batchId;
    const added = await bulk(
      toBatch,
      (ids) => api.addToBatch(batchId, ids, idemKey(run, 'add', batchId)),
      '배치 담기',
      exclude,
      sleep,
    );
    for (const id of added) state.boxes.push(box(id, batchId, 'location'));
    save();
    log(`배치에 넣음 ${added.length}/${toBatch.length}`);
  }

  // 5. 시작(위치 배정) — 전부 아니면 전무. 막힌 상자는 빼고 다시.
  const ownNotStarted = created || (ownBatch !== undefined && ownBatch.startedAt == null);
  if (state.batchId && ownNotStarted) {
    await start(api, state.batchId, run, state, exclude, save, log);
  }

  // 6. 송장번호 — 라벨·CSV 가 쓴다
  for (const b of state.boxes) {
    if (b.trackingNo != null) continue;
    b.trackingNo = (await api.activeWaybill(b.shipmentId))?.trackingNo ?? null;
    if (b.trackingNo == null) log(`송장번호 없음: ${b.shipmentId} — 상자 보기에서 송장을 확인한다`);
  }
  save();
  log(
    `상자 ${state.boxes.length} · 이번 실행에서 뺀 상자 ${state.excluded.length}${state.batchId ? ` · 배치 ${state.batchId}` : ''}`,
  );
  return state;
}

async function start(
  api: CoreApi,
  batchId: string,
  run: string,
  state: RunState,
  exclude: (shipmentId: string, reason: string) => void,
  save: () => void,
  log: (l: string) => void,
): Promise<void> {
  const excludeKey = (shipmentId: string) => idemKey(run, 'exclude', shipmentId);
  const own = () => state.boxes.filter((b) => b.batchId === batchId).length;
  for (let attempt = 0; ; attempt++) {
    if (own() === 0) {
      log(`배치 ${batchId} 에 남은 상자가 없어 시작하지 않는다`);
      return;
    }
    try {
      await api.startBatch(batchId, idemKey(run, 'start', batchId));
      log(`배치 시작 ${batchId}`);
      return;
    } catch (error) {
      if (!(error instanceof CoreApiError) || error.code !== BATCH_START_BLOCKED) throw error;
      const blockers = startBlockers(error.body);
      if (blockers.size === 0) {
        throw new Error(`배치 ${batchId} 시작이 막혔는데 막힌 상자 목록이 비어 있다 — 배치는 시작 전으로 남는다`);
      }
      if (attempt >= MAX_START_RETRIES) {
        throw new Error(
          `배치 ${batchId} 시작이 ${attempt + 1}번 막혔다(마지막: ${[...blockers.keys()].join(', ')}) — 배치는 시작 전으로 남는다. ` +
            '같은 --run 으로 다시 돌리면 이어서 빼고 시작한다',
        );
      }
      for (const [shipmentId, reasons] of blockers) {
        // 먼저 적고 뺀다. 거꾸로면 core 가 뺀 뒤 죽었을 때 다음 실행이 그 상자를 resume 분류에서 다시 집어
        // 같은 담기 키로 넣고, core 는 옛 성공을 재생해 «배치에 없는 상자»가 run.json 에 남는다.
        const reason = `비상 출고 — 시작 막힘: ${reasons.join(', ')}`;
        exclude(shipmentId, reason);
        save();
        const stored = state.excluded.find((e) => e.shipmentId === shipmentId)?.reason ?? reason;
        await api.excludeFromBatch(batchId, shipmentId, stored, excludeKey(shipmentId));
      }
      log(`시작 막힘 — ${blockers.size}개 배치에서 뺌, 다시 시작한다`);
    }
  }
}

/**
 * 앞 실행이 «뺐다»고 run.json 에 적었는데 core 에 빼기가 닿지 않았을 수 있다(적은 뒤 죽음·응답 실패).
 * 시작 전인 이 실행의 배치에 그 상자가 아직 활성으로 있으면 그 목록.
 */
function pendingExcludes(
  prev: RunState | null,
  own: { batch: BatchListItem; workItems: WorkItem[] } | undefined,
): Skipped[] {
  if (!prev || !own || own.batch.startedAt != null) return [];
  const recorded = new Map(prev.excluded.map((e) => [e.shipmentId, e]));
  return own.workItems.flatMap((w) => {
    if (w.status === 'completed' || w.status === 'excluded') return [];
    const e = recorded.get(w.shipmentId);
    return e ? [e] : [];
  });
}

/** 사유는 적어 둔 그대로 보낸다 — core 가 사유를 멱등 해시에 넣어, 같은 키·다른 사유는 불일치가 된다. */
async function finishPendingExcludes(
  api: CoreApi,
  batchId: string,
  run: string,
  pending: Skipped[],
  log: (l: string) => void,
): Promise<void> {
  for (const p of pending) {
    await api.excludeFromBatch(batchId, p.shipmentId, p.reason, idemKey(run, 'exclude', p.shipmentId));
    log(`배치 ${batchId}에서 마저 뺌 ${p.shipmentId}`);
  }
}

// ── 도움 ────────────────────────────────────────────────────────────

/**
 * 송장 결과가 일시적인가 — 어드민 진행 창(outbound-preparation-runner.ts)과 같은 판정.
 * core 가 transient: false 라고 하면 확정 실패. 아니면 시간 예산 초과·발급 대기(pending·allocated)·transient 는 다시.
 */
function waybillRetryable(r: PreparationWaybillResult): boolean {
  if (r.transient === false) return false;
  return (
    r.reason === 'time-budget-exceeded' || r.status === 'pending' || r.status === 'allocated' || r.transient === true
  );
}

/** 상자마다 결과를 주는 묶음 명령(계획 확정·배치 담기). `transient` 실패만 같은 키로 다시 부르고, 그래도 안 되면 뺀다. */
async function bulk(
  ids: string[],
  call: (chunk: string[]) => Promise<BulkShipmentResult>,
  step: string,
  exclude: (shipmentId: string, reason: string) => void,
  sleep: (ms: number) => Promise<void>,
): Promise<string[]> {
  const ok: string[] = [];
  for (const chunk of chunks(ids)) {
    let remaining = chunk;
    for (let retries = 0; ; retries++) {
      const res = await call(remaining);
      const failed = new Map(res.failed.map((f) => [f.shipmentId, f]));
      if (res.failed.some((f) => f.code === IDEMPOTENCY_MISMATCH)) throw mismatchError();
      const succeeded = new Set(res.succeeded);
      const again: string[] = [];
      for (const id of remaining) {
        const f = failed.get(id);
        if (f?.transient && retries < RETRY_DELAYS_MS.length) again.push(id);
        else if (f) {
          const tried = f.transient ? ` — ${retries}번 다시 시도해도 안 됨` : '';
          exclude(id, `비상 출고 — ${step} 실패: ${f.code} (${f.message})${tried}`);
        } else if (succeeded.has(id)) ok.push(id);
        else exclude(id, `비상 출고 — ${step} 응답에 없음`);
      }
      if (again.length === 0) break;
      await sleep(RETRY_DELAYS_MS[retries]);
      remaining = again;
    }
  }
  return ok;
}

function chunks(ids: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(ids.slice(i, i + CHUNK));
  return out;
}

/** BATCH_START_BLOCKED 본문의 `errors[]` → 상자 id 마다 사유(중복 없이). */
function startBlockers(body: unknown): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!isRecord(body) || !Array.isArray(body.errors)) return out;
  for (const e of body.errors) {
    if (!isRecord(e) || typeof e.shipmentId !== 'string') continue;
    const reason = typeof e.reason === 'string' ? e.reason : 'UNKNOWN';
    const reasons = out.get(e.shipmentId) ?? [];
    if (!reasons.includes(reason)) reasons.push(reason);
    out.set(e.shipmentId, reasons);
  }
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function mismatchError(): Error {
  return new Error(
    `멱등 키가 다른 요청으로 이미 쓰였다(${IDEMPOTENCY_MISMATCH}) — 이어 돌리기는 같은 사람만 된다. ` +
      '다른 사람이 이어받으려면 새 --run 으로 시작한다',
  );
}
