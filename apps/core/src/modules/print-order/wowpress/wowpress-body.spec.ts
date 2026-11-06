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
    awkjob: [{ status: 200, jobcostno: 12, cost: 1100, ...awk }],
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
});
