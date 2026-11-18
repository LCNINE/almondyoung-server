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
  WorkItem,
} from './core-api';
import { readRun, RunBox, RunState, writeRun } from './run-state';
import { Route, selectTargets, Skipped, Target } from './select';

export interface PrepareReport {
  targets: Target[];
  skipped: Skipped[];
  /** dry-run 은 null */
  state: RunState | null;
}

export interface PrepareOptions {
  warehouseId: string;
  run: string;
  dir: string;
  apply: boolean;
  log: (line: string) => void;
}

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

  const input = await gather(api, warehouseId);
  const selected = selectTargets({
    ready: input.ready,
    resume: input.resume,
    otherBuckets: input.otherBuckets,
    batches: input.batches,
    ownBatchId: prev?.batchId ?? undefined,
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

  if (targets.length === 0) {
    log('대상 0 — 아무것도 바꾸지 않는다');
    return { targets, skipped, state: opts.apply ? prev : null };
  }
  if (!opts.apply) {
    log('dry-run — 아무것도 바꾸지 않았다. 실행하려면 --apply');
    return { targets, skipped, state: null };
  }

  try {
    const state = await apply(api, opts, prev, ownBatch, own?.workItems ?? [], targets, orderNos);
    return { targets, skipped, state };
  } catch (error) {
    if (error instanceof CoreApiError && error.code === IDEMPOTENCY_MISMATCH) throw mismatchError();
    throw error;
  }
}

// ── 읽기 ────────────────────────────────────────────────────────────

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
  ownItems: WorkItem[],
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
  const prevBoxes = new Map((prev?.boxes ?? []).map((b) => [b.shipmentId, b]));
  const box = (shipmentId: string, batchId: string, route: Route): RunBox => {
    const p = prevBoxes.get(shipmentId);
    const same = p?.batchId === batchId;
    return { shipmentId, route, batchId, trackingNo: same ? p.trackingNo : null, printed: same ? p.printed : false };
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
    const ok = await bulk(drafts, (ids) => api.plan(ids, idemKey(run, 'plan', run)), '계획 확정', exclude);
    toWaybill = [...ok, ...planned];
    save();
    log(`계획 확정 ${ok.length}/${drafts.length}`);
  }

  // 2. 송장 일괄 발급(draft+planned) — 시작이 상자마다 발송 가능한 송장을 본다
  const toBatch: string[] = [];
  if (toWaybill.length > 0) {
    for (const chunk of chunks(toWaybill)) {
      const results = new Map(
        (await api.issueWaybills(chunk, idemKey(run, 'waybill', run))).map((r) => [r.shipmentId, r]),
      );
      for (const id of chunk) {
        const r = results.get(id);
        if (r?.code === IDEMPOTENCY_MISMATCH) throw mismatchError();
        if (!r) exclude(id, '비상 출고 — 송장 발급 응답에 없음');
        else if (r.status !== 'registered') {
          exclude(id, `비상 출고 — 송장 발급 안 됨: ${r.code ?? r.status}${r.reason ? ` (${r.reason})` : ''}`);
        } else toBatch.push(id);
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
    );
    for (const id of added) state.boxes.push(box(id, batchId, 'location'));
    save();
    log(`배치에 넣음 ${added.length}/${toBatch.length}`);
  }

  // 5. 시작(위치 배정) — 전부 아니면 전무. 막힌 상자는 빼고 다시.
  const ownNotStarted = created || (ownBatch !== undefined && ownBatch.startedAt == null);
  if (state.batchId && ownNotStarted) {
    await start(api, state.batchId, run, state, ownItems, exclude, save, log);
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
  ownItems: WorkItem[],
  exclude: (shipmentId: string, reason: string) => void,
  save: () => void,
  log: (l: string) => void,
): Promise<void> {
  const excludeKey = (shipmentId: string) => idemKey(run, 'exclude', shipmentId);
  // 앞 실행이 «뺐다»고 적었는데 core 에 빼기가 닿지 않았을 수 있다(적은 뒤 죽음) — 시작 전에 마저 뺀다.
  // 사유는 적어 둔 그대로 보낸다: core 가 사유를 멱등 해시에 넣어, 같은 키·다른 사유는 불일치가 된다.
  for (const item of ownItems) {
    if (item.status === 'completed' || item.status === 'excluded') continue;
    const recorded = state.excluded.find((e) => e.shipmentId === item.shipmentId);
    if (!recorded) continue;
    await api.excludeFromBatch(batchId, item.shipmentId, recorded.reason, excludeKey(item.shipmentId));
    log(`앞 실행에서 뺀 상자를 배치에서 마저 뺌 ${item.shipmentId}`);
  }

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

// ── 도움 ────────────────────────────────────────────────────────────

async function bulk(
  ids: string[],
  call: (chunk: string[]) => Promise<BulkShipmentResult>,
  step: string,
  exclude: (shipmentId: string, reason: string) => void,
): Promise<string[]> {
  const ok: string[] = [];
  for (const chunk of chunks(ids)) {
    const res = await call(chunk);
    const failed = new Map(res.failed.map((f) => [f.shipmentId, f]));
    if (res.failed.some((f) => f.code === IDEMPOTENCY_MISMATCH)) throw mismatchError();
    const succeeded = new Set(res.succeeded);
    for (const id of chunk) {
      const f = failed.get(id);
      if (f) exclude(id, `비상 출고 — ${step} 실패: ${f.code} (${f.message})`);
      else if (succeeded.has(id)) ok.push(id);
      else exclude(id, `비상 출고 — ${step} 응답에 없음`);
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
