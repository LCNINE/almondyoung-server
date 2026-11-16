'use client';

import { useRef, useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useCanRun } from '@/hooks/use-permission';
import type { PermissionRequirement } from '@/lib/auth/mutation-permission';
import { client } from '@/lib/api/client';
import { ANALYTICS_SERVICE_BASE_URL } from '@/const/api-const';
import { Button } from '@/components/ui/button';
import { useGrowthSummary } from '@/lib/services/analytics';
import { useOrderRefunds } from '@/lib/services/wallet/queries';
import { refundMap } from '../growth/model';
import { appendGoalEvidence } from './goal-export';
import { kstToday } from '@/features/statistics/as-of';
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
    mutationFn: (rows: ExternalRevenueRow[]) =>
      client.post(`${URL}/external`, { rows }),
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
  const cache = useQueryClient();
  const importer = useImportRevenueRows();
  const writeAccess = useCanRun(useImportRevenueRows);
  const canImport = writeAccess.status === 'ready' && writeAccess.allowed;
  const report = useQuery({
    queryKey: ['revenue-report', year],
    queryFn: async () =>
      (await client.get<RevenueReport>(`${URL}?year=${year}`)).data,
  });

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
      const XLSX = await import('xlsx');
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        book,
        XLSX.utils.json_to_sheet(totals, {
          header: [
            '채널',
            '계정',
            '매출기준',
            '확인금액',
            '등록월',
            '미등록월',
          ],
        }),
        '채널별 확인 금액'
      );
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
          ['자료 조회 시각', report.data.extractedAt ?? '미확인'],
          [
            '목표 실적 근거',
            goal?.goal
              ? '화면 실적 대사 및 일별 실적 근거 시트 참조'
              : '이 연도의 목표 근거 미수집',
          ],
          [
            '미수집 채널',
            Object.entries(CHANNELS)
              .filter(
                ([key]) => !report.data!.external.some((r) => r.channel === key)
              )
              .map(([, label]) => label)
              .join(', ') || '등록된 채널별 미등록월 확인 필요',
          ],
          [
            '원본 확인',
            '외부 자료는 출처와 인식 기준을 확인해야 합니다. 과세·면세·쿠폰·배송비·수수료·정산액은 총매출에서 임의로 역산하지 않습니다.',
          ],
          ['추출 시각', new Date().toISOString()],
          [
            '기존 집계',
            '총매출 - 취소 - 환불. 목표 카드의 별도 결제 환불과 과거 실적 입력은 포함하지 않습니다.',
          ],
          [
            '외부 자료',
            '매출 기준별로 구분합니다. 기존 집계와 중복될 수 있어 자동 합산하지 않습니다.',
          ],
          ['누락', '미등록 채널·월은 미수집이며 0원이 아닙니다.'],
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

        for (let page = 0; ; page += 1) {
          if (page >= 1000)
            throw new Error(
              '원장이 100만 행을 초과합니다. 다운로드 범위를 나누어야 합니다.'
            );

          const response = await client.get<{
            rows: Array<Record<string, unknown>>;
            hasMore: boolean;
          }>(`${URL}/raw?year=${year}&page=${page}`);
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
    setPending([]);
    setMessage('');
    if (!file) return;

    try {
      if (file.size > 5 * 1024 * 1024)
        throw new Error('월별 취합 파일은 5MB 이하로 올려 주세요.');

      const XLSX = await import('xlsx');
      const book = /\.csv$/i.test(file.name)
        ? XLSX.read(await file.text(), { type: 'string', raw: true })
        : XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet =
        book.Sheets['외부 채널 월별 자료'] ?? book.Sheets[book.SheetNames[0]];
      setPending(
        parseExternalRevenue(
          XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' })
        )
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : '파일을 읽지 못했습니다.'
      );
    }
  }

  async function save() {
    setBusy(true);

    try {
      await importer.mutateAsync(pending);
      setPending([]);
      await cache.invalidateQueries({ queryKey: ['revenue-report'] });
      setMessage(
        '저장했습니다. 같은 채널·계정·월·기준의 기존 값은 교체되었습니다.'
      );
    } catch {
      setMessage(
        '저장하지 못했습니다. 통계 설정 권한과 연결 상태를 확인해 주세요.'
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
      XLSX.utils.aoa_to_sheet([HEADERS]),
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
            disabled={busy}
            type="number"
            min={2020}
            max={2100}
            value={year}
            onChange={(e) => {
              const value = Number(e.target.value);
              setPending([]);
              if (Number.isInteger(value) && value >= 2020 && value <= 2100)
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
            goalQuery.isLoading ||
            Boolean(goal?.goal && refundsQuery.isLoading)
          }
          onClick={() => download(false)}
        >
          세무사 검토용 엑셀
        </Button>
        <Button
          variant="outline"
          disabled={
            busy ||
            !report.data ||
            report.isError ||
            goalQuery.isLoading ||
            Boolean(goal?.goal && refundsQuery.isLoading)
          }
          onClick={() => download(true)}
        >
          주문 원장 포함 엑셀
        </Button>
      </div>
      <p className="text-sm text-gray-600">
        위 기간 필터와 별도로 선택한 연도의 자료를 조회합니다. 기존 주문 집계와
        외부 자료는 기준이 달라 자동 합산하지 않습니다. 올해 목표 실적의 근거도
        엑셀에 함께 포함됩니다. 금액은 원 단위입니다.
      </p>
      <p className="text-sm text-amber-800">
        미등록 채널·월은 미수집입니다. 전화 주문은 기존 자사몰 주문에 포함되지
        않은 자료만 등록하세요.
      </p>
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
                {t.확인금액.toLocaleString()}원
              </p>
              <p className="text-sm text-gray-600">
                {t.매출기준} · 등록월 {t.등록월}
              </p>
              <p className="text-sm text-amber-800">
                미등록월: {t.미등록월} (0원 아님)
              </p>
            </div>
          ))}
          {Object.entries(CHANNELS)
            .filter(
              ([key]) => !report.data!.external.some((r) => r.channel === key)
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
        <Button variant="outline" onClick={template}>
          취합 양식 다운로드
        </Button>
        <Button
          variant="outline"
          disabled={busy || !canImport}
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
            <Button disabled={busy || !canImport} onClick={save}>
              {pending.length}행 확인 후 저장
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setPending([])}
            >
              취소
            </Button>
          </>
        ) : null}
      </div>
      <p className="text-xs text-gray-500">
        양식 채널: 쿠팡 / 스마트스토어 / 전화 주문. 매출기준: 구매확정 /
        결제완료 / 주문 / 부가세 신고자료. 월: YYYY-MM. 매출액: 원 단위 정수.
        출처에 보고서명과 조회 기준일을 적어 주세요. 저장에는 통계 설정 권한이
        필요합니다.
      </p>
      {report.isLoading ? <p>자료를 불러오는 중입니다.</p> : null}
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
      {pending.length ? (
        <p className="font-medium">
          저장 전 미리보기 · 기존 값과 같은 채널·계정·월·기준은 교체됩니다.
        </p>
      ) : null}
      <div className="max-h-96 overflow-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              {HEADERS.map((h) => (
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
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && !report.isLoading ? (
          <p className="py-4 text-sm text-gray-500">
            등록된 외부 채널 자료가 없습니다.
          </p>
        ) : null}
      </div>
    </section>
  );
}
