import { useNavigate } from '@tanstack/react-router';
import { loadFailed } from '../../core/data/loadFailed';
import { Button } from '../../core/design/Button';
import { LoadFailure } from '../../core/design/LoadFailure';
import { cn } from '../../core/design/cn';
import {
  remainingOf,
  useBatchPickList,
  type BatchPickList,
} from '../../domains/outbound/pickList';

const SECONDARY =
  'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50';
const TH =
  'border-b-2 border-[#15171C] px-3 py-2 text-left text-[14px] font-semibold';
const TD = 'border-b border-[#C3C8D2] px-3 py-2.5';

function formatAt(ms: number): string {
  return new Date(ms).toLocaleString('ko-KR', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * 배치 피킹 목록 — 위치 순서대로 어느 선반에서 무엇을 몇 개 집는지. A4 를 OS 인쇄 대화상자로 뽑는다
 * (송장 프린터에는 송장 용지가 걸려 있다). 셸의 탭 바·기능키 바·상태바는 인쇄에서 빠진다.
 */
export function PickListScreen({ batchId }: { batchId: string }) {
  const navigate = useNavigate();
  const list = useBatchPickList(batchId);
  const back = () =>
    void navigate({ to: '/outbound/batches', state: { batchId } });
  const failed = loadFailed(list);
  // 오프라인이면 다시 받기가 «멈춤»으로 남는다(isFetching 이 아님) — 그때도 확인되지 않은 목록이다
  const checking = list.isFetching || list.isPaused;
  const unconfirmed = failed || checking;

  return (
    <div className="mx-auto max-w-[210mm] space-y-3">
      <div className="flex items-center gap-2 print:hidden">
        <Button type="button" className={SECONDARY} onClick={back}>
          배치 현황으로
        </Button>
        <h1 className="flex-1 text-lg font-semibold">피킹 목록</h1>
        {list.data && list.data.rows.length > 0 && !failed ? (
          // 다시 받는 동안은 막는다 — 화면을 떠난 사이 바뀐 목록을 옛것으로 뽑지 않게
          <Button
            type="button"
            disabled={checking}
            onClick={() => window.print()}
          >
            {checking ? '목록 확인 중…' : '인쇄'}
          </Button>
        ) : null}
      </div>
      {failed ? (
        <LoadFailure
          className="text-base print:hidden"
          message="피킹 목록을 불러오지 못했어요."
          error={list.error}
          stale={list.data !== undefined}
          retrying={list.isFetching}
          onRetry={() => void list.refetch()}
        />
      ) : null}
      {list.data ? (
        <>
          {/* 확인되지 않은 목록은 종이로 나가지 않게 한다(단축키 인쇄 포함) */}
          {unconfirmed ? (
            <p className="hidden text-lg print:block">
              목록을 다시 확인하지 못해 인쇄하지 않았어요. 화면에서 다시 확인한
              뒤 인쇄해 주세요.
            </p>
          ) : null}
          <div className={cn(unconfirmed && 'print:hidden')}>
            <PickListSheet list={list.data} at={list.dataUpdatedAt} />
          </div>
        </>
      ) : list.isPending && !failed ? (
        <p className="p-3 text-lg text-[#535968]">
          피킹 목록을 불러오고 있어요.
        </p>
      ) : null}
    </div>
  );
}

function PickListSheet({ list, at }: { list: BatchPickList; at: number }) {
  if (list.startedAt === null)
    return (
      <p className="p-3 text-lg text-[#535968]">
        작업을 시작해야 피킹 목록이 생겨요. 배치 현황에서 «작업 시작»을 눌러
        주세요.
      </p>
    );
  if (list.rows.length === 0)
    return (
      <p className="p-3 text-lg text-[#535968]">
        이 배치에는 집을 상품이 남아 있지 않아요.
      </p>
    );
  const remaining = list.rows.reduce((sum, row) => sum + remainingOf(row), 0);
  const picked = list.rows.some((row) => row.pickedQty > 0);
  return (
    <article className="bg-white p-6 text-[#15171C] print:p-0">
      <header className="mb-4 flex items-end justify-between border-b-2 border-[#15171C] pb-2">
        <h2 className="font-mono text-2xl font-bold">{list.batchNumber}</h2>
        <p className="text-[15px]">
          상자 {list.boxes}개 · 집을 수량 {remaining}개 · {formatAt(at)} 기준
        </p>
      </header>
      <table className="w-full border-collapse text-[16px]">
        <thead>
          <tr>
            <th className={cn(TH, 'w-10')} aria-label="확인" />
            <th className={cn(TH, 'w-40')}>위치</th>
            <th className={TH}>상품</th>
            <th className={cn(TH, 'w-32 text-right')}>수량</th>
            <th className={cn(TH, 'w-16 text-right')}>상자</th>
          </tr>
        </thead>
        <tbody>
          {list.rows.map((row) => {
            const left = remainingOf(row);
            return (
              <tr
                key={`${row.locationCode}\u0000${row.skuId}`}
                className={cn(
                  'break-inside-avoid',
                  left === 0 && 'text-[#8A909C]'
                )}
              >
                <td className={TD}>
                  <span className="block h-5 w-5 rounded-sm border-2 border-[#15171C]" />
                </td>
                <td className={cn(TD, 'font-mono font-semibold')}>
                  {row.locationCode}
                </td>
                <td className={TD}>
                  <span className="block font-semibold">{row.skuName}</span>
                  <span className="block font-mono text-[13px] text-[#535968]">
                    {row.skuCode}
                  </span>
                </td>
                <td className={cn(TD, 'text-right whitespace-nowrap')}>
                  {left === 0 ? (
                    <span className="text-[15px] font-semibold">다 집음</span>
                  ) : (
                    <span className="font-mono text-xl font-bold">{left}</span>
                  )}
                  {left > 0 && row.pickedQty > 0 ? (
                    <span className="block text-[12px] font-normal text-[#535968]">
                      {row.qty}개 중 {row.pickedQty} 집음
                    </span>
                  ) : null}
                </td>
                <td className={cn(TD, 'text-right font-mono')}>{row.boxes}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {picked ? (
        <p className="mt-3 text-[14px] text-[#535968]">
          수량은 이미 집은 것을 뺀 남은 수량이에요.
        </p>
      ) : null}
    </article>
  );
}
