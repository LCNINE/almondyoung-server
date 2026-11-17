import { buildJobs, judgeJobcost } from './wowpress-body';

const sent = buildJobs(
  { prsjob: [{ colorno: 256, jobno: 3110, wsize: 90 }], awkjob: [{ jobno: 23010 }], qtyPerUnit: 500 },
  1,
);

function response(
  over: Record<string, unknown> = {},
  prs: Record<string, unknown> = {},
  awk: Record<string, unknown> = {},
) {
  return {
    status: 200,
    errmsg: '성공하였습니다.',
    ordcost_sup: 4100,
    ordcost_bill: 4510,
    prsjob: [{ status: 200, jobqty: 500, colorno0: 256, wsize: 90, cost: 3000, jobcostno: 7, ...prs }],
    awkjob: [{ status: 200, jobqty: 500, jobcostno: 12, cost: 1100, ...awk }],
    ...over,
  };
}

describe('buildJobs', () => {
  it('puts jobqty on every job and mirrors colorno into colorno0', () => {
    expect(
      buildJobs({ prsjob: [{ colorno: 256, jobno: 3110 }], awkjob: [{ jobno: 23010 }], qtyPerUnit: 500 }, 2),
    ).toEqual({
      prsjob: [{ colorno: 256, colorno0: 256, jobno: 3110, jobqty: 1000 }],
      awkjob: [{ jobno: 23010, jobqty: 1000 }],
    });
  });

  it('adds no colorno0 when colorno is absent', () => {
    expect(buildJobs({ prsjob: [{ jobno: 1 }], awkjob: [], qtyPerUnit: 200 }, 1).prsjob).toEqual([
      { jobno: 1, jobqty: 200 },
    ]);
  });
});

describe('judgeJobcost', () => {
  it('accepts a faithful response', () => {
    expect(judgeJobcost(sent, response())).toEqual({ ok: true, supply: 4100, bill: 4510 });
  });

  it('unwraps a full resultMap body', () => {
    expect(judgeJobcost(sent, { resultMap: { cjson_jobcost: response() } })).toEqual({
      ok: true,
      supply: 4100,
      bill: 4510,
    });
  });

  it('rejects a nonexistent post-processing job', () => {
    expect(judgeJobcost(sent, response({}, {}, { jobcostno: -1 })).ok).toBe(false);
  });

  it('rejects a top-level failure status', () => {
    const v = judgeJobcost(sent, response({ status: 900, errmsg: '실패' }));
    expect(v).toEqual({ ok: false, reason: expect.stringContaining('실패') });
  });

  it('rejects an echoed jobqty that differs', () => {
    expect(judgeJobcost(sent, response({}, { jobqty: 100 })).ok).toBe(false);
  });

  it('rejects an echoed colorno0 that differs', () => {
    expect(judgeJobcost(sent, response({}, { colorno0: 4 })).ok).toBe(false);
  });

  it('rejects an echoed wsize that differs', () => {
    expect(judgeJobcost(sent, response({}, { wsize: 50 })).ok).toBe(false);
  });

  it('rejects a missing cost total and unknown shapes', () => {
    expect(judgeJobcost(sent, response({ ordcost_sup: undefined })).ok).toBe(false);
    expect(judgeJobcost(sent, 'x').ok).toBe(false);
  });

  it('checks awkjob jobqty echo', () => {
    const s = buildJobs({ prsjob: [], awkjob: [{ jobno: 1 }], qtyPerUnit: 1000 }, 1);
    const res = (awk: Record<string, unknown>) => ({
      status: 200,
      ordcost_sup: 1,
      ordcost_bill: 1,
      prsjob: [],
      awkjob: [{ status: 200, jobcostno: 5, ...awk }],
    });
    expect(judgeJobcost(s, res({ jobqty: 1000 })).ok).toBe(true);
    expect(judgeJobcost(s, res({ jobqty: 100 })).ok).toBe(false);
    expect(judgeJobcost(s, res({})).ok).toBe(false);
  });

  it('fails when sent value or echo is not numeric', () => {
    const s = buildJobs({ prsjob: [{ jobno: 1, wsize: 'invalid' }], awkjob: [], qtyPerUnit: 1 }, 1);
    const res = { status: 200, ordcost_sup: 1, ordcost_bill: 1, prsjob: [{ status: 200, jobqty: 1 }], awkjob: [] };
    expect(judgeJobcost(s, res).ok).toBe(false);
  });

  it('accepts string echoes of numeric sent sizes', () => {
    const s = buildJobs({ prsjob: [{ jobno: 1, wsize: 90, hsize: 90 }], awkjob: [], qtyPerUnit: 1 }, 1);
    const res = {
      status: 200,
      ordcost_sup: 1,
      ordcost_bill: 1,
      prsjob: [{ status: 200, jobqty: 1, wsize: '90', hsize: '90' }],
      awkjob: [],
    };
    expect(judgeJobcost(s, res).ok).toBe(true);
  });

  it('treats a missing awkjob as empty only when none were sent', () => {
    const none = buildJobs({ prsjob: [{ jobno: 1 }], awkjob: [], qtyPerUnit: 1 }, 1);
    const some = buildJobs({ prsjob: [{ jobno: 1 }], awkjob: [{ jobno: 2 }], qtyPerUnit: 1 }, 1);
    const res = { status: 200, ordcost_sup: 1, ordcost_bill: 1, prsjob: [{ status: 200, jobqty: 1 }] };
    expect(judgeJobcost(none, res).ok).toBe(true);
    expect(judgeJobcost(some, res).ok).toBe(false);
  });
});
