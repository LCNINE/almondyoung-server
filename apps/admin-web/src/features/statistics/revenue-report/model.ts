export interface ExternalRevenueRow {
  channel: string;
  account: string;
  month: string;
  basis: string;
  amount: number;
  source: string;
  updatedAt?: string;
  originalStatus?: string;
  monthlyStatus?: string;
  duplicateStatus?: string;
  settlementStatus?: string;
  reviewNote?: string;
}

export interface RevenueReport {
  year: number;
  history?: Array<{
    id: string;
    recordedAt: string;
    before: ExternalRevenueRow[];
    after: ExternalRevenueRow[];
  }>;
  extractedAt?: string;
  daily: Array<{
    date: string;
    channel: string;
    orders: number;
    gross: number;
    cancelled: number;
    refunded: number;
  }>;
  external: ExternalRevenueRow[];
}

export const CHANNELS: Record<string, string> = {
  coupang: '쿠팡',
  naver: '스마트스토어',
  phone: '전화 주문',
  cafe24: '카페24',
};
export const BASES: Record<string, string> = {
  purchase_confirmed: '구매확정',
  paid: '결제완료',
  order: '주문',
  tax_report: '부가세 신고자료',
  operational_net: '운영 순매출',
};
export const REVIEW_HEADERS = [
  '원본확보',
  '월별대조',
  '중복확인',
  '입금대조',
  '대조메모',
];
export const REVIEW_FIELDS = [
  'originalStatus',
  'monthlyStatus',
  'duplicateStatus',
  'settlementStatus',
] as const;
export const reviewLabel = (value?: string) =>
  value === 'confirmed' ? '확인' : '미확인';
export const rowKey = (row: ExternalRevenueRow) =>
  JSON.stringify([row.channel, row.account, row.month, row.basis]);

export const HEADERS = ['채널', '계정', '월', '매출기준', '매출액', '출처'];

/** Deliberately accept a documented template only. Unknown native exports must not be guessed into sales. */
export function parseExternalRevenue(rows: unknown[][]): ExternalRevenueRow[] {
  if (!HEADERS.every((header, i) => rows[0]?.[i] === header)) {
    throw new Error(
      `첫 행은 ${HEADERS.join(', ')} 순서여야 합니다. 양식을 내려받아 작성해 주세요.`
    );
  }

  const keys = new Set<string>();
  const result: ExternalRevenueRow[] = [];

  rows.slice(1).forEach((cells, index) => {
    if (cells.every((value) => value == null || value === '')) return;

    const [channel, account, month, basis, rawAmount, source] = cells;
    const amount =
      typeof rawAmount === 'number'
        ? rawAmount
        : Number(String(rawAmount ?? '').replace(/,/g, ''));
    const entry: ExternalRevenueRow = {
      channel: labelKey(CHANNELS, channel),
      account: String(account ?? '').trim(),
      month: String(month ?? '').trim(),
      basis: labelKey(BASES, basis),
      amount,
      source: String(source ?? '').trim(),
    };
    if (rows[0].length > HEADERS.length) {
      if (!REVIEW_HEADERS.every((header, i) => rows[0][i + 6] === header))
        throw new Error(
          '대조 항목은 최신 취합 양식의 열 순서를 사용해 주세요.'
        );
      REVIEW_FIELDS.forEach((field, i) => {
        const value = String(cells[i + 6] ?? '').trim();
        if (!['', '미확인', '확인', 'pending', 'confirmed'].includes(value))
          throw new Error(
            `${index + 2}행 대조 상태는 확인 또는 미확인으로 입력해 주세요.`
          );
        entry[field] = ['확인', 'confirmed'].includes(value)
          ? 'confirmed'
          : 'pending';
      });
      entry.reviewNote = String(cells[10] ?? '').trim();
      if (
        entry.reviewNote.length > 1000 ||
        (REVIEW_FIELDS.some((field) => entry[field] === 'confirmed') &&
          !entry.reviewNote)
      )
        throw new Error(
          `${index + 2}행 확인 근거를 대조메모에 1,000자 이내로 적어 주세요.`
        );
    }
    const key = JSON.stringify([
      entry.channel,
      entry.account,
      entry.month,
      entry.basis,
    ]);

    if (
      !Object.hasOwn(CHANNELS, entry.channel) ||
      !Object.hasOwn(BASES, entry.basis) ||
      !entry.account ||
      entry.account.length > 100 ||
      !entry.source ||
      entry.source.length > 255 ||
      !/^20\d{2}-(0[1-9]|1[0-2])$/.test(entry.month) ||
      rawAmount == null ||
      String(rawAmount).trim() === '' ||
      (typeof rawAmount !== 'number' &&
        !/^-?(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(String(rawAmount).trim())) ||
      !Number.isSafeInteger(amount) ||
      Math.abs(amount) > 1_000_000_000_000 ||
      keys.has(key)
    ) {
      throw new Error(
        `${index + 2}행의 채널·계정·월·기준·금액·출처 또는 중복을 확인해 주세요.`
      );
    }

    keys.add(key);
    result.push(entry);
  });

  if (!result.length || result.length > 1200)
    throw new Error('1~1,200행을 입력해 주세요.');

  return result;
}

export function externalTable(rows: ExternalRevenueRow[]) {
  return [
    [...HEADERS, ...REVIEW_HEADERS],
    ...rows.map((r) => [
      r.channel,
      r.account,
      r.month,
      r.basis,
      r.amount,
      r.source,
      ...REVIEW_FIELDS.map((field) => reviewLabel(r[field])),
      r.reviewNote ?? '',
    ]),
  ];
}

export function externalMonthlyStatistics(
  rows: ExternalRevenueRow[],
  year: number
) {
  const groups = new Map<
    string,
    { key: string; label: string; amounts: Map<string, number> }
  >();

  for (const row of rows) {
    if (!row.month.startsWith(`${year}-`)) continue;
    const key = JSON.stringify([row.channel, row.account, row.basis]);
    const group = groups.get(key) ?? {
      key: `series${groups.size}`,
      label: `${CHANNELS[row.channel] ?? row.channel} · ${row.account} · ${BASES[row.basis] ?? row.basis}`,
      amounts: new Map<string, number>(),
    };
    group.amounts.set(row.month, row.amount);
    groups.set(key, group);
  }

  const series = [...groups.values()];
  const months = Array.from({ length: 12 }, (_, i) => {
    const month = `${year}-${String(i + 1).padStart(2, '0')}`;
    const values: Record<string, number | string | null> = { month };
    for (const group of series)
      values[group.key] = group.amounts.get(month) ?? null;
    return values;
  });

  return { series: series.map(({ key, label }) => ({ key, label })), months };
}

function labelKey(labels: Record<string, string>, value: unknown): string {
  const text = String(value ?? '').trim();
  return (
    Object.entries(labels).find(([, label]) => label === text)?.[0] ?? text
  );
}

/** Different accounts and recognition bases must never silently become a company revenue total. */
export function revenueSummary(report: RevenueReport, throughMonth: number) {
  const groups = new Map<
    string,
    {
      channel: string;
      account: string;
      basis: string;
      amount: number;
      months: Set<string>;
      rows: ExternalRevenueRow[];
    }
  >();
  for (const row of report.external) {
    if (!row.month.startsWith(`${report.year}-`)) continue;
    const key = JSON.stringify([row.channel, row.account, row.basis]);
    const group = groups.get(key) ?? {
      channel: row.channel,
      account: row.account,
      basis: row.basis,
      amount: 0,
      months: new Set<string>(),
      rows: [],
    };
    group.rows.push(row);
    group.amount += row.amount;
    group.months.add(row.month);
    groups.set(key, group);
  }
  return [...groups.values()].map((g) => ({
    채널: CHANNELS[g.channel] ?? g.channel,
    계정: g.account,
    매출기준: BASES[g.basis] ?? g.basis,
    확인금액: g.amount,
    대조상태: REVIEW_FIELDS.map(
      (field, i) =>
        `${REVIEW_HEADERS[i]} ${g.rows.filter((row) => row[field] === 'confirmed').length}/${g.rows.length}개월`
    ).join(' · '),
    마지막반영:
      g.rows
        .map((row) => row.updatedAt ?? '')
        .sort()
        .at(-1) || '미확인',
    등록월: [...g.months]
      .sort()
      .map((m) => m.slice(5))
      .join(', '),
    미등록월:
      Array.from({ length: throughMonth }, (_, i) =>
        String(i + 1).padStart(2, '0')
      )
        .filter((m) => !g.months.has(`${report.year}-${m}`))
        .join(', ') || '없음',
  }));
}

export function importPreview(
  pending: ExternalRevenueRow[],
  existing: ExternalRevenueRow[]
) {
  const stored = new Map(existing.map((row) => [rowKey(row), row]));
  return pending.map((row) => ({ row, previous: stored.get(rowKey(row)) }));
}

export function reviewTable(rows: ExternalRevenueRow[]) {
  return rows.map((row) => ({
    채널: CHANNELS[row.channel] ?? row.channel,
    계정: row.account,
    월: row.month,
    매출기준: BASES[row.basis] ?? row.basis,
    원본확보: reviewLabel(row.originalStatus),
    월별대조: reviewLabel(row.monthlyStatus),
    중복확인: reviewLabel(row.duplicateStatus),
    입금대조: reviewLabel(row.settlementStatus),
    대조메모: row.reviewNote ?? '',
    마지막반영: row.updatedAt ?? '미확인',
    출처: row.source,
  }));
}
