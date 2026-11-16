export interface ExternalRevenueRow {
  channel: string;
  account: string;
  month: string;
  basis: string;
  amount: number;
  source: string;
  updatedAt?: string;
}

export interface RevenueReport {
  year: number;
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
};
export const BASES: Record<string, string> = {
  purchase_confirmed: '구매확정',
  paid: '결제완료',
  order: '주문',
  tax_report: '부가세 신고자료',
};
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
    const entry = {
      channel: labelKey(CHANNELS, channel),
      account: String(account ?? '').trim(),
      month: String(month ?? '').trim(),
      basis: labelKey(BASES, basis),
      amount,
      source: String(source ?? '').trim(),
    };
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
    HEADERS,
    ...rows.map((r) => [
      r.channel,
      r.account,
      r.month,
      r.basis,
      r.amount,
      r.source,
    ]),
  ];
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
    };
    group.amount += row.amount;
    group.months.add(row.month);
    groups.set(key, group);
  }
  return [...groups.values()].map((g) => ({
    채널: CHANNELS[g.channel] ?? g.channel,
    계정: g.account,
    매출기준: BASES[g.basis] ?? g.basis,
    확인금액: g.amount,
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
