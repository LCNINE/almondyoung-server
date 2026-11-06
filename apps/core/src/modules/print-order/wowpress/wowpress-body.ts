import { z } from 'zod';
import { type WowpressLineSpec } from './wowpress.types';

export interface WowpressJobs {
  prsjob: Record<string, unknown>[];
  awkjob: Record<string, unknown>[];
}

export type JobcostVerdict = { ok: true; supply: number; bill: number } | { ok: false; reason: string };

const record = z.record(z.string(), z.unknown());
const numeric = z
  .union([
    z.number(),
    z
      .string()
      .trim()
      .regex(/^-?\d+(\.\d+)?$/),
  ])
  .transform(Number);

function asRecord(v: unknown): Record<string, unknown> | null {
  const r = record.safeParse(v);
  return r.success ? r.data : null;
}

function toNumber(v: unknown): number | null {
  const r = numeric.safeParse(v);
  return r.success ? r.data : null;
}

function recordList(v: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(v)) return null;
  const rows = v.map(asRecord);

  return rows.every((r): r is Record<string, unknown> => r !== null) ? rows : null;
}

// 와우프레스는 수량을 ordqty 가 아니라 각 작업의 jobqty 로 계산한다. 양면(colorno)도 colorno0 이 없으면 단면으로 계산된다
export function buildJobs(spec: Pick<WowpressLineSpec, 'prsjob' | 'awkjob' | 'qtyPerUnit'>, qty: number): WowpressJobs {
  const jobqty = spec.qtyPerUnit * qty;

  return {
    prsjob: spec.prsjob.map((job) => ({
      ...job,
      ...(job.colorno !== undefined ? { colorno0: job.colorno } : {}),
      jobqty,
    })),
    awkjob: spec.awkjob.map((job) => ({ ...job, jobqty })),
  };
}

function fail(reason: string): JobcostVerdict {
  return { ok: false, reason };
}

// 와우프레스는 모르는 값을 무시하고도 성공을 돌려준다. 보낸 값이 응답에 그대로 돌아왔는지 하나씩 확인한다
export function judgeJobcost(sent: WowpressJobs, response: unknown): JobcostVerdict {
  const root = asRecord(response);
  if (!root) return fail('견적 응답을 읽을 수 없습니다');
  const body = asRecord(asRecord(root.resultMap)?.cjson_jobcost) ?? root;

  if (toNumber(body.status) !== 200) {
    const msg = typeof body.errmsg === 'string' && body.errmsg !== '' ? body.errmsg : `status ${String(body.status)}`;

    return fail(`견적 실패: ${msg}`);
  }

  const prsjob = recordList(body.prsjob);
  const awkjob = recordList(body.awkjob);
  if (!prsjob || prsjob.length !== sent.prsjob.length) return fail('견적 응답의 인쇄 작업 수가 보낸 값과 다릅니다');
  if (!awkjob || awkjob.length !== sent.awkjob.length) return fail('견적 응답의 후가공 작업 수가 보낸 값과 다릅니다');

  for (const [i, job] of sent.prsjob.entries()) {
    const echo = prsjob[i];
    if (toNumber(echo.status) !== 200) return fail(`인쇄 작업 ${i + 1} 견적 실패`);

    for (const key of ['jobqty', 'colorno0', 'wsize', 'hsize']) {
      if (job[key] === undefined) continue;
      if (toNumber(echo[key]) !== toNumber(job[key])) {
        return fail(
          `인쇄 작업 ${i + 1} 의 ${key} 가 반영되지 않았습니다 (보냄 ${String(job[key])}, 응답 ${String(echo[key])})`,
        );
      }
    }
  }

  for (const [i, job] of sent.awkjob.entries()) {
    const echo = awkjob[i];
    const costno = toNumber(echo.jobcostno);
    if (toNumber(echo.status) !== 200 || costno === null || costno <= 0) {
      return fail(`후가공 ${String(job.jobno)} 가 존재하지 않거나 견적에 반영되지 않았습니다`);
    }
  }

  const supply = toNumber(body.ordcost_sup);
  const bill = toNumber(body.ordcost_bill);
  if (supply === null || bill === null) return fail('견적 금액이 응답에 없습니다');

  return { ok: true, supply, bill };
}
