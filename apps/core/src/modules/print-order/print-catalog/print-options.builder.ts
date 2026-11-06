import { z } from 'zod';
import { WowpressProdInfo } from '../wowpress/wowpress.types';

export interface PrintOptionAxes {
  prodno: number;
  prodname: string;
  cutsizeHalfMm: number;
  papers: { paperno: number; label: string }[];
  colors: { colorno: number; label: string; jobno: number }[];
  quantities: { key: string; values: number[] }[];
  requiredAwk: { group: string; options: { jobno: number; label: string }[]; defaultJobno: number }[];
  forbiddenAwk: { jobno: number; reason: string }[];
}

const nullableNumber = z.number().nullish();

const restrictionSchema = z.object({
  min_width: nullableNumber,
  max_width: nullableNumber,
  min_height: nullableNumber,
  max_height: nullableNumber,
  min_sum_wh: nullableNumber,
  joblist: z.array(z.object({ jobno: z.number(), jobname: z.string().optional() })),
});

const sizeinfoSchema = z.array(
  z.object({
    sizelist: z.array(
      z.object({
        sizeno: z.number(),
        width: z.number(),
        height: z.number(),
        cutsize: nullableNumber,
        rst_awkjob: z.array(restrictionSchema).nullish(),
      }),
    ),
  }),
);

const paperinfoSchema = z.array(
  z.object({ paperlist: z.array(z.object({ paperno: z.number(), papername: z.string() })) }),
);

const colorinfoSchema = z.array(
  z.object({
    pagelist: z.array(
      z.object({
        colorlist: z.array(
          z.object({
            colorno: z.number(),
            colorname: z.string(),
            req_prsjob: z.array(z.object({ jobno: z.number() })).nullish(),
          }),
        ),
      }),
    ),
  }),
);

const ordqtySchema = z.array(
  z.object({
    sizeno: nullableNumber,
    paperno: nullableNumber,
    colorno: nullableNumber,
    ordqtylist: z.array(z.number()).nullish(),
  }),
);

const prsjobinfoSchema = z.array(
  z.object({
    prsjoblist: z.array(
      z.object({
        jobno: z.number(),
        req_color: z.array(z.object({ colorno: z.number() })).nullish(),
      }),
    ),
  }),
);

const awkjobinfoSchema = z.array(
  z.object({
    jobgrouplist: z.array(
      z.object({
        jobgroup: z.string(),
        type: z.string(),
        awkjoblist: z.array(z.object({ jobno: z.number(), jobname: z.string() })),
      }),
    ),
  }),
);

type Restriction = z.infer<typeof restrictionSchema>;

const outOfRange = (r: Restriction, width: number, height: number): boolean =>
  (r.min_width != null && width < r.min_width) ||
  (r.max_width != null && width > r.max_width) ||
  (r.min_height != null && height < r.min_height) ||
  (r.max_height != null && height > r.max_height) ||
  (r.min_sum_wh != null && width + height < r.min_sum_wh);

const conditionKey = (parts: [string, number | null | undefined][]): string => {
  const set = parts.filter(([, v]) => v != null).map(([k, v]) => `${k}:${v}`);

  return set.length > 0 ? set.join('|') : 'all';
};

export function buildPrintOptions(
  prodInfo: WowpressProdInfo,
  product: { sizeno: number; wsize?: number; hsize?: number },
): PrintOptionAxes {
  const sizes = sizeinfoSchema.parse(prodInfo.sizeinfo ?? []).flatMap((s) => s.sizelist);
  const size = sizes.find((s) => s.sizeno === product.sizeno);
  if (!size) throw new Error(`size ${product.sizeno} not in prod ${prodInfo.prodno}`);

  const width = product.wsize ?? size.width;
  const height = product.hsize ?? size.height;

  const forbidden = new Map<number, string>();
  for (const restriction of size.rst_awkjob ?? []) {
    if (!outOfRange(restriction, width, height)) continue;

    for (const job of restriction.joblist) {
      forbidden.set(job.jobno, `${width}x${height} 은 후가공 허용 크기 밖`);
    }
  }

  const papers = paperinfoSchema
    .parse(prodInfo.paperinfo ?? [])
    .flatMap((p) => p.paperlist)
    .map((p) => ({ paperno: p.paperno, label: p.papername }));

  const prsJobs = prsjobinfoSchema.parse(prodInfo.prsjobinfo ?? []).flatMap((g) => g.prsjoblist);

  // 색상 자체의 인쇄 작업 → req_color 가 그 색상을 가리키는 작업 → 작업이 하나뿐이면 그것
  const resolvePrsJobno = (colorno: number, own: number | undefined): number => {
    if (own !== undefined) return own;

    const byColor = prsJobs.find((j) => j.req_color?.some((c) => c.colorno === colorno));
    if (byColor) return byColor.jobno;

    if (prsJobs.length === 1) return prsJobs[0].jobno;

    throw new Error(`prs jobno not resolvable for color ${colorno} in prod ${prodInfo.prodno}`);
  };

  const colors = colorinfoSchema
    .parse(prodInfo.colorinfo ?? [])
    .flatMap((c) => c.pagelist)
    .flatMap((p) => p.colorlist)
    .map((c) => ({
      colorno: c.colorno,
      label: c.colorname,
      jobno: resolvePrsJobno(c.colorno, c.req_prsjob?.[0]?.jobno),
    }));

  const quantities = ordqtySchema
    .parse(prodInfo.ordqty ?? [])
    .filter((q) => q.sizeno == null || q.sizeno === product.sizeno)
    .map((q) => ({
      key: conditionKey([
        ['sizeno', q.sizeno],
        ['paperno', q.paperno],
        ['colorno', q.colorno],
      ]),
      values: q.ordqtylist ?? [],
    }));

  const requiredAwk = awkjobinfoSchema
    .parse(prodInfo.awkjobinfo ?? [])
    .flatMap((a) => a.jobgrouplist)
    .filter((g) => g.type === 'radio' && g.awkjoblist.length > 0)
    .map((g) => ({
      group: g.jobgroup,
      options: g.awkjoblist.map((j) => ({ jobno: j.jobno, label: j.jobname })),
      defaultJobno: g.awkjoblist[0].jobno,
    }));

  return {
    prodno: prodInfo.prodno,
    prodname: prodInfo.prodname,
    cutsizeHalfMm: (size.cutsize ?? 0) / 2,
    papers,
    colors,
    quantities,
    requiredAwk,
    forbiddenAwk: [...forbidden].map(([jobno, reason]) => ({ jobno, reason })),
  };
}
