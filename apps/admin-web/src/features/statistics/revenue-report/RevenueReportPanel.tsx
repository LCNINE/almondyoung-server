'use client';

import { useRef, useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useCanRun } from '@/hooks/use-permission';
import type { PermissionRequirement } from '@/lib/auth/mutation-permission';
import { client } from '@/lib/api/client';
import { isCustomError } from '@/lib/api/customError';
import { ANALYTICS_SERVICE_BASE_URL } from '@/const/api-const';
import { Button } from '@/components/ui/button';
import { useGrowthSummary } from '@/lib/services/analytics';
import { useOrderRefunds } from '@/lib/services/wallet/queries';
import { walletApi } from '@/lib/api/domains/wallet';
import { addDays } from '../growth/calendar';
import { refundMap } from '../growth/model';
import { appendGoalEvidence } from './goal-export';
import { appendCompanyRevenueEvidence } from './company-revenue-export';
import { kstToday } from '@/features/statistics/as-of';
import { RevenueDocuments } from './RevenueDocuments';
import {
  REVIEW_HEADERS,
  REVIEW_FIELDS,
  reviewLabel,
  reviewTable,
  importPreview,
  decodeRevenueCsv,
  rowKey,
} from './model';
import { ExternalRevenueStatistics } from './ExternalRevenueStatistics';
import {
  BASES,
  CHANNELS,
  ExternalRevenueRow,
  externalTable,
  HEADERS,
  parseExternalRevenue,
  RevenueReport,
  revenueSummary,
} from './model';

const URL = `${ANALYTICS_SERVICE_BASE_URL}/statistics/revenue-report`;

export function useImportRevenueRows() {
  return useMutation({
    mutationFn: (input: { rows: ExternalRevenueRow[]; batchId: string }) =>
      client.post(`${URL}/external`, input),
  });
}
useImportRevenueRows.permission = [
  'analytics.setting.write',
] as const satisfies PermissionRequirement;

export function RevenueReportPanel() {
  const [year, setYear] = useState(Number(kstToday().slice(0, 4)));
  const [pending, setPending] = useState<ExternalRevenueRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const readGeneration = useRef(0);
  const batchId = useRef('');
  const [reading, setReading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const cache = useQueryClient();
  const importer = useImportRevenueRows();
  const writeAccess = useCanRun(useImportRevenueRows);
  const canImport = writeAccess.status === 'ready' && writeAccess.allowed;
  const report = useQuery({
    queryKey: ['revenue-report', year],
    queryFn: async () =>
      (
        await client.get<RevenueReport>(
          `${URL}?year=${year}&includeHistory=false`
        )
      ).data,
  });

  const historyOptions = {
    queryKey: ['revenue-report-history', year],
    queryFn: async () =>
      (
        await client.get<NonNullable<RevenueReport['history']>>(
          `${URL}/history?year=${year}`
        )
      ).data,
    staleTime: 60_000,
  };
  const historyQuery = useQuery({ ...historyOptions, enabled: historyOpen });

  const goalQuery = useGrowthSummary();
  const goal = goalQuery.data?.year === year ? goalQuery.data : undefined;
  const refundsQuery = useOrderRefunds(
    `${year}-01-01`,
    goal?.today ?? kstToday(),
    Boolean(goal?.goal)
  );
  const throughMonth =
    year < Number(kstToday().slice(0, 4))
      ? 12
      : year === Number(kstToday().slice(0, 4))
        ? Number(kstToday().slice(5, 7))
        : 0;
  const totals = report.data ? revenueSummary(report.data, throughMonth) : [];

  async function download(raw: boolean) {
    if (!report.data) return;

    setBusy(true);
    setMessage('');

    try {
      const history = await cache.fetchQuery({
        ...historyOptions,
        staleTime: 0,
      });
      const XLSX = await import('xlsx');
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        book,
        XLSX.utils.json_to_sheet(totals, {
          header: [
            '채널',
            '계정',
            '매출기준',
            '등록금액',
            '등록월',
            '미등록월',
            '대조상태',
            '마지막반영(UTC)',
          ],
        }),
        '채널별 등록 금액'
      );
      XLSX.utils.book_append_sheet(
        book,
        XLSX.utils.json_to_sheet(reviewTable(report.data.external)),
        '자료 대조 상태'
      );
      XLSX.utils.book_append_sheet(
        book,
        XLSX.utils.json_to_sheet(
          history.flatMap((batch) =>
            batch.after
              .filter((row) => row.month.startsWith(`${year}-`))
              .map((row) => ({
                '반영시각(UTC)': batch.recordedAt,
                ...Object.fromEntries(
                  Object.entries(reviewTable([row])[0]).filter(
                    ([key]) => key !== '마지막반영(UTC)'
                  )
                ),
                반영금액: row.amount,
                이전금액:
                  batch.before.find(
                    (old) =>
                      old.channel === row.channel &&
                      old.account === row.account &&
                      old.month === row.month &&
                      old.basis === row.basis
                  )?.amount ?? '신규',
              }))
          )
        ),
        '최근 반영 이력'
      );
      if (goal) {
        const membership = await walletApi.getMembershipRevenue(
          `${year}-01-01`,
          addDays(goal.today, -1)
        );
        if (membership.paymentCount === undefined)
          throw new Error('멤버십 결제 집계 확인 필요');
        appendCompanyRevenueEvidence(
          XLSX,
          book,
          goal,
          refundsQuery.isError ? null : refundMap(refundsQuery.data?.series),
          report.data.external,
          'all',
          membership
        );
      }
      if (goal?.goal)
        appendGoalEvidence(
          XLSX,
          book,
          goal,
          refundsQuery.isError ? null : refundMap(refundsQuery.data?.series)
        );
      const daily = report.data.daily.map((r) => ({
        일자: r.date,
        채널: r.channel,
        주문수: r.orders,
        총매출: r.gross,
        취소: r.cancelled,
        환불: r.refunded,
        순매출: r.gross - r.cancelled - r.refunded,
      }));
      XLSX.utils.book_append_sheet(
        book,
        XLSX.utils.json_to_sheet(daily),
        '기존 일별 집계'
      );
      XLSX.utils.book_append_sheet(
        book,
        XLSX.utils.aoa_to_sheet(externalTable(report.data.external)),
        '외부 채널 월별 자료'
      );
      XLSX.utils.book_append_sheet(
        book,
        XLSX.utils.aoa_to_sheet([
          ['항목', '설명'],
          ['조회 연도', year],
          [
            '자료 성격',
            '세무사 검토용 임시 취합. 신고액 확정 자료가 아닙니다.',
          ],
          ['자료 조회 시각(UTC)', report.data.extractedAt ?? '미확인'],
          [
            '목표 실적 근거',
            goal?.goal
              ? '통합 목표·월별 채널 매출 시트 참조. 과거 수기 포함 집계는 화면 실적 대사에 별도 보관'
              : '이 연도의 목표 근거 미수집',
          ],
          [
            '미수집 채널',
            Object.entries(CHANNELS)
              .filter(
                ([key]) => !report.data.external.some((r) => r.channel === key)
              )
              .map(([, label]) => label)
              .join(', ') || '등록된 채널별 미등록월 확인 필요',
          ],
          [
            '원본 확인',
            '외부 자료는 출처와 인식 기준을 확인해야 합니다. 과세·면세·쿠폰·배송비·수수료·정산액은 총매출에서 임의로 역산하지 않습니다.',
          ],
          ['추출 시각(UTC)', new Date().toISOString()],
          [
            '기존 집계',
            '총매출 - 취소 - 환불. 목표 카드의 별도 결제 환불과 과거 실적 입력은 포함하지 않습니다.',
          ],
          [
            '외부 자료',
            '통합 목표에는 반영 가능한 자료만 잠정 합산합니다. 채널 반영 근거 시트에서 제외 사유를 확인하세요.',
          ],
          ['누락', '미등록 채널·월은 미수집이며 0원이 아닙니다.'],
          [
            '반영 이력',
            '해당 연도를 포함하는 최근 50회만 표시합니다. 이력 기능 적용 전 저장 기록은 포함하지 않습니다.',
          ],
          [
            '조회 범위',
            '다운로드 시점의 운영 자료입니다. 조회 도중 기존 주문 정정이 반영될 수 있으며 결산 시점 고정 원장이 아닙니다.',
          ],
          [
            '주문 상품 원장',
            '주문 발생일(KST) 기준. 취소·환불 전 상품 금액으로 순매출과 다릅니다.',
          ],
          [
            '과거 실적',
            '카페24 등 이관 전 주문 원장이 없으면 목표 카드의 수동 입력액만으로 원장을 복원할 수 없습니다.',
          ],
        ]),
        '집계 기준'
      );

      if (raw) {
        const sheet = XLSX.utils.aoa_to_sheet([
          [
            '원장ID',
            '발생시각(UTC)',
            '채널',
            '주문키',
            '주문ID',
            '외부주문ID',
            '상품주문ID',
            '상품명',
            '수량',
            '단가',
            '상품금액',
            '통화',
          ],
        ]);

        let after: string | null = null;
        let through: string | null = null;
        for (let page = 0; ; page += 1) {
          if (page >= 1000)
            throw new Error(
              '원장이 100만 행을 초과합니다. 다운로드 범위를 나누어야 합니다.'
            );

          const response: {
            data: {
              rows: Array<Record<string, unknown>>;
              hasMore: boolean;
              next: string | null;
              through: string | null;
            };
          } = await client.get(
            `${URL}/raw?year=${year}${after ? `&after=${after}&through=${through}` : ''}`
          );
          after = response.data.next;
          through = response.data.through;
          XLSX.utils.sheet_add_aoa(
            sheet,
            response.data.rows.map((r) => [
              r.id,
              r.occurredAt,
              r.channel,
              r.orderKey,
              r.orderId,
              r.externalOrderId,
              r.orderItemId,
              r.productName,
              r.quantity,
              r.unitPrice,
              r.totalPrice,
              r.currency,
            ]),
            { origin: -1 }
          );
          setMessage(
            `주문 상품 원장 ${(page * 1000 + response.data.rows.length).toLocaleString()}행 수집 중`
          );

          if (!response.data.hasMore) break;
          if (!after || !through)
            throw new Error(
              '원장 조회 경계를 확인하지 못했습니다. 새로고침 후 다시 내려받아 주세요.'
            );
        }

        XLSX.utils.book_append_sheet(book, sheet, '주문 상품 원장');
      }

      for (const name of book.SheetNames) {
        const sheet = book.Sheets[name];
        sheet['!cols'] = Array.from(
          { length: XLSX.utils.decode_range(sheet['!ref'] ?? 'A1').e.c + 1 },
          (_, i) => ({
            wch: name === '집계 기준' && i === 1 ? 110 : i === 5 ? 65 : 24,
          })
        );
      }
      XLSX.writeFile(book, `아몬드영_${year}_세무사검토용_매출자료.xlsx`);
      setMessage('엑셀 다운로드를 완료했습니다.');
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : '다운로드에 실패했습니다.'
      );
    } finally {
      setBusy(false);
    }
  }

  async function read(file?: File) {
    const generation = ++readGeneration.current;
    setPending([]);
    setMessage('');
    setReading(Boolean(file));
    if (!file) return;

    try {
      if (file.size > 5 * 1024 * 1024)
        throw new Error('월별 취합 파일은 5MB 이하로 올려 주세요.');

      const XLSX = await import('xlsx');
      const book = /\.csv$/i.test(file.name)
        ? XLSX.read(decodeRevenueCsv(await file.arrayBuffer()), {
            type: 'string',
            raw: true,
          })
        : XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet =
        book.Sheets['외부 채널 월별 자료'] ?? book.Sheets[book.SheetNames[0]];
      const parsed = parseExternalRevenue(
        XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' })
      );
      if (parsed.some((row) => !row.month.startsWith(`${year}-`)))
        throw new Error(
          '선택한 연도와 파일의 연도가 다릅니다. 연도별로 나누어 불러와 주세요.'
        );
      if (generation === readGeneration.current) {
        const current = new Map(
          (report.data?.external ?? []).map((row) => [rowKey(row), row])
        );
        setPending(
          parsed.map((row) => ({
            ...row,
            expectedUpdatedAt: current.get(rowKey(row))?.updatedAt ?? null,
          }))
        );
        batchId.current = crypto.randomUUID();
      }
    } catch (error) {
      if (generation === readGeneration.current)
        setMessage(
          error instanceof Error ? error.message : '파일을 읽지 못했습니다.'
        );
    } finally {
      if (generation === readGeneration.current) setReading(false);
    }
  }

  async function save() {
    if (pending.some((row) => !row.month.startsWith(`${year}-`))) {
      setMessage(
        '선택한 연도와 업로드 자료의 연도가 다릅니다. 연도별로 나누어 등록해 주세요.'
      );
      return;
    }
    setBusy(true);

    try {
      await importer.mutateAsync({ rows: pending, batchId: batchId.current });
      setPending([]);
      await cache.invalidateQueries({ queryKey: ['revenue-report'] });
      await cache.invalidateQueries({ queryKey: ['revenue-report-history'] });
      setMessage('저장 결과를 반영했습니다. 반영 이력과 금액을 확인해 주세요.');
    } catch (error) {
      if (isCustomError(error) && error.statusCode === 409) setPending([]);
      await cache.invalidateQueries({ queryKey: ['revenue-report'] });
      await cache.invalidateQueries({ queryKey: ['revenue-report-history'] });
      setMessage(
        `${error instanceof Error ? error.message : '저장 결과를 확인하지 못했습니다.'} 반영 이력을 확인해 주세요. 자료가 변경되었다면 파일을 다시 불러와 주세요.`
      );
    } finally {
      setBusy(false);
    }
  }

  async function template() {
    const XLSX = await import('xlsx');
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      book,
      (() => {
        const sheet = XLSX.utils.aoa_to_sheet([
          [...HEADERS, ...REVIEW_HEADERS],
        ]);
        for (let row = 1; row <= 1200; row++)
          sheet[`C${row + 1}`] = { t: 's', v: '', z: '@' };
        sheet['!ref'] = 'A1:K1201';
        return sheet;
      })(),
      '외부 채널 월별 자료'
    );
    XLSX.writeFile(book, '외부채널_월별매출_양식.xlsx');
  }

  const rows = pending.length ? pending : (report.data?.external ?? []);

  return (
    <section
      id="revenue-report"
      className="mb-6 space-y-3 rounded-xl border bg-white p-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-semibold">매출 자료</h2>
        <label className="text-sm">
          연도{' '}
          <input
            aria-label="매출 자료 연도"
            disabled={busy || reading}
            type="number"
            min={2020}
            max={2099}
            value={year}
            onChange={(e) => {
              const value = Number(e.target.value);
              readGeneration.current += 1;
              setReading(false);
              setPending([]);
              if (Number.isInteger(value) && value >= 2020 && value <= 2099)
                setYear(value);
            }}
            className="w-24 rounded border px-2 py-1"
          />
        </label>
        <Button
          variant="outline"
          disabled={
            busy ||
            !report.data ||
            report.isError ||
            goalQuery.isPending ||
            Boolean(goal?.goal && refundsQuery.isPending)
          }
          onClick={() => {
            void download(false);
          }}
        >
          세무사 검토용 엑셀
        </Button>
        <Button
          variant="outline"
          disabled={
            busy ||
            !report.data ||
            report.isError ||
            goalQuery.isPending ||
            Boolean(goal?.goal && refundsQuery.isPending)
          }
          onClick={() => {
            void download(true);
          }}
        >
          주문 원장 포함 엑셀
        </Button>
      </div>
      <p className="text-sm text-gray-600">
        위 기간 필터와 별도로 선택한 연도의 자료를 조회합니다. 기존 주문 집계와
        외부 자료 중 반영 가능한 금액은 상단 회사 전체 매출에 합산됩니다. 올해
        목표 실적의 근거도 엑셀에 함께 포함됩니다. 금액은 원 단위입니다.
      </p>
      <p className="text-sm text-amber-800">
        미등록 채널·월은 미수집입니다. 전화 주문은 기존 자사몰 주문에 포함되지
        않은 자료만 등록하세요.
      </p>
      <RevenueDocuments />
      <div className="rounded-lg bg-slate-50 p-3 text-sm space-y-1">
        <p className="font-medium">전체 매출 대조 중</p>
        <p>
          출처 미확인 수기 누적액은 회사 전체 매출에서 제외합니다. 카페24
          전환기·이관 주문은 중복을 확인한 뒤 반영합니다.
        </p>
        <p>
          운영 순매출은 채널 화면의 참고 금액입니다. 신고자료·구매확정·결제완료
          기준과 구분해 확인하세요.
        </p>
        <p>
          원본확보 → 월별대조 → 중복확인 → 입금대조. ‘확인’은 입력자가 근거를
          기록한 상태이며 자동 검증이나 신고 확정을 뜻하지 않습니다.
        </p>
      </div>
      {report.data && !report.isError ? (
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            업로드 원본별 내역 · 메두사 자동 집계 제외
          </summary>
          <p className="my-3 text-sm text-gray-600">
            회사 전체 매출과 자사몰 추이는 상단에서 확인하세요. 아래는 업로드한
            원본의 금액만 보여줍니다. 카페24에서 새 자사몰로 전환한 이후 매출은
            메두사 자동 집계에 포함되므로 이 원본 내역에는 나타나지 않습니다.
          </p>
          <ExternalRevenueStatistics rows={report.data.external} year={year} />
        </details>
      ) : null}
      {report.data ? (
        <div className="grid gap-3 md:grid-cols-3">
          {totals.map((t) => (
            <div
              key={JSON.stringify([t.채널, t.계정, t.매출기준])}
              className="rounded-lg border p-3"
            >
              <p className="font-medium">
                {t.채널} · {t.계정}
              </p>
              <p className="text-xl font-semibold tabular-nums">
                {t.등록금액.toLocaleString()}원
              </p>
              <p className="text-sm text-gray-600">
                {t.매출기준} · 등록월 {t.등록월}
              </p>
              <p className="text-xs text-gray-600">{t.대조상태}</p>
              <p className="text-sm text-amber-800">
                {t.미등록월 === '없음'
                  ? '미등록월 없음'
                  : `미등록월: ${t.미등록월} · 부분 합계`}
              </p>
            </div>
          ))}
          {Object.entries(CHANNELS)
            .filter(
              ([key]) => !report.data.external.some((r) => r.channel === key)
            )
            .map(([key, label]) => (
              <div
                key={key}
                className="rounded-lg border border-dashed p-3 text-gray-600"
              >
                {label}: 미수집
              </div>
            ))}
        </div>
      ) : null}
      {goalQuery.isError ? (
        <p className="text-amber-800">
          목표 실적 근거를 조회하지 못했습니다. 엑셀에 미수집으로 표시됩니다.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => {
            void template();
          }}
        >
          취합 양식 다운로드
        </Button>
        <Button
          variant="outline"
          disabled={
            busy ||
            reading ||
            !canImport ||
            !report.data ||
            report.isFetching ||
            report.isError
          }
          onClick={() => fileInput.current?.click()}
        >
          외부 채널 엑셀 불러오기
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => {
            void read(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        {pending.length > 0 ? (
          <>
            <Button
              disabled={
                busy ||
                !canImport ||
                report.isFetching ||
                report.isError ||
                !report.data
              }
              onClick={() => {
                void save();
              }}
            >
              {pending.length}행 확인 후 저장
            </Button>
            <Button
              variant="outline"
              disabled={busy || reading}
              onClick={() => {
                readGeneration.current += 1;
                setReading(false);
                setPending([]);
              }}
            >
              취소
            </Button>
          </>
        ) : null}
      </div>
      <p className="text-xs text-gray-500">
        양식 채널: 쿠팡 / 스마트스토어 / 카페24 / 전화 주문. 매출기준: 구매확정
        / 결제완료 / 주문 / 부가세 신고자료 / 운영 순매출. 월: YYYY-MM. 매출액:
        원 단위 정수. 출처에 보고서명과 조회 기준일을 적어 주세요. 대조 항목은
        확인 또는 미확인으로 입력하고 확인 근거를 대조메모에 적어 주세요. 기존
        6열 양식은 모두 미확인으로 반영됩니다. 저장에는 통계 설정 권한이
        필요합니다.
      </p>
      {reading ? <p role="status">파일을 읽는 중입니다.</p> : null}
      {report.isPending ? <p>자료를 불러오는 중입니다.</p> : null}
      {report.isError ? (
        <p role="alert" className="text-red-600">
          자료를 불러오지 못했습니다. 서버 연결을 확인해 주세요.
        </p>
      ) : null}
      {message ? (
        <p role="status" className="text-sm">
          {message}
        </p>
      ) : null}
      <p className="text-sm text-gray-600">
        채널 자료 다운로드 → 원본 보관 → 취합 양식 작성 → 불러오기·교체 금액
        확인 → 저장. 계정명이나 매출기준을 바꾸면 별도 자료로 등록됩니다.
      </p>
      {pending.length ? (
        <div className="max-h-80 overflow-auto rounded border p-3 text-sm">
          <h3 className="font-medium">반영 전 비교</h3>
          <p>
            선택한 연도의 자료만 저장할 수 있습니다. 기존 자료 교체 시 대조
            상태도 함께 교체됩니다.
          </p>
          {importPreview(pending, report.data?.external ?? []).map(
            ({ row, previous }) => (
              <p
                key={JSON.stringify([
                  row.channel,
                  row.account,
                  row.month,
                  row.basis,
                ])}
              >
                {CHANNELS[row.channel]} · {row.account} · {row.month} ·{' '}
                {BASES[row.basis]}:{' '}
                {previous
                  ? `${previous.amount.toLocaleString()}원 → ${row.amount.toLocaleString()}원 (교체)`
                  : `${row.amount.toLocaleString()}원 (신규)`}
                {previous ? (
                  <span className="block text-xs text-gray-600">
                    {REVIEW_FIELDS.map(
                      (field, index) =>
                        `${REVIEW_HEADERS[index]}: ${reviewLabel(previous[field])} → ${reviewLabel(row[field])}`
                    ).join(' · ')}
                    {' · '}대조메모:{' '}
                    {previous.reviewNote === row.reviewNote
                      ? '유지'
                      : row.reviewNote
                        ? '교체'
                        : '삭제'}
                  </span>
                ) : null}
              </p>
            )
          )}
        </div>
      ) : null}
      {pending.length ? (
        <p className="font-medium">
          저장 전 미리보기 · 기존 값과 같은 채널·계정·월·기준은 교체됩니다.
        </p>
      ) : null}
      <div className="max-h-96 overflow-auto">
        <table className="w-full min-w-[1100px] text-left text-sm">
          <thead>
            <tr>
              {[...HEADERS, ...REVIEW_HEADERS, '마지막 반영'].map((h) => (
                <th key={h} className="border-b p-2">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={JSON.stringify([r.channel, r.account, r.month, r.basis])}
              >
                <td className="p-2">{CHANNELS[r.channel] ?? r.channel}</td>
                <td className="p-2">{r.account}</td>
                <td className="p-2">{r.month}</td>
                <td className="p-2">{BASES[r.basis] ?? r.basis}</td>
                <td className="p-2 tabular-nums">
                  {r.amount.toLocaleString()}원
                </td>
                <td className="p-2">{r.source}</td>
                {REVIEW_FIELDS.map((field) => (
                  <td key={field} className="p-2">
                    {reviewLabel(r[field])}
                  </td>
                ))}
                <td className="p-2">{r.reviewNote || '—'}</td>
                <td className="p-2">
                  {r.updatedAt
                    ? new Date(r.updatedAt).toLocaleString('ko-KR', {
                        timeZone: 'Asia/Seoul',
                      })
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && !report.isPending ? (
          <p className="py-4 text-sm text-gray-500">
            등록된 외부 채널 자료가 없습니다.
          </p>
        ) : null}
      </div>
      <details
        className="rounded border p-3 text-sm"
        onToggle={(event) => setHistoryOpen(event.currentTarget.open)}
      >
        <summary className="cursor-pointer font-medium">
          최근 반영 이력 (최대 50회)
        </summary>
        <p>
          이력 기능 적용 이후 저장한 자료부터 기록됩니다. 이전 값은 검토용
          엑셀에도 포함됩니다.
        </p>
        {historyOpen && historyQuery.isPending ? (
          <p>이력을 불러오는 중입니다.</p>
        ) : null}
        {historyQuery.isError ? (
          <p role="alert">반영 이력을 불러오지 못했습니다.</p>
        ) : null}
        {(historyQuery.data ?? []).map((batch) => (
          <p key={batch.id}>
            {new Date(batch.recordedAt).toLocaleString('ko-KR', {
              timeZone: 'Asia/Seoul',
            })}{' '}
            · {batch.after.length}행 반영 · {batch.before.length}행 교체
          </p>
        ))}
      </details>
    </section>
  );
}
