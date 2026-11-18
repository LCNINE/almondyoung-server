import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import { ConflictError, type ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { RemovedOnStartNotice, StartBatchButton } from './StartBatchButton';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

function mount(opts: { request: (o: { path: string; body?: unknown }) => Promise<unknown>; onStarted?: (outcome: { removed: number; uncertain: number }) => void }) {
  const client: ApiClient = { request: opts.request as unknown as ApiClient['request'] };
  const qc = new QueryClient();
  qc.setQueryData(['outbound-batches', 'wh-1', 'created'], []);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={client}>{children}</ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  render(<StartBatchButton batchId="b-1" onStarted={opts.onStarted} />, { wrapper });
  return { client: qc, user: userEvent.setup() };
}

describe('StartBatchButton', () => {
  it('누르면 POST /picking/v2/starts 를 보내고 배치 목록을 무효화한다', async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const { client, user } = mount({
      request: async (o) => {
        calls.push({ path: o.path, body: o.body });
        return { state: 'started', batchId: 'b-1', sessionId: 'x' };
      },
    });
    await user.click(screen.getByRole('button', { name: '작업 시작' }));
    expect(calls).toEqual([{ path: '/picking/v2/starts', body: { batchId: 'b-1' } }]);
    expect(client.getQueryState(['outbound-batches', 'wh-1', 'created'])?.isInvalidated).toBe(true);
  });

  it('막히면 사유별 묶음과 안내를 보여 주고, 다시 누를 수 있다', async () => {
    const { user } = mount({
      request: async () => {
        throw new ConflictError('m', 'BATCH_START_BLOCKED', undefined, [
          { shipmentId: 's1', reason: 'INBOUND_PENDING', shipmentLineId: 'l1', skuId: 'k', requiredQty: 2, shortQty: 2, detail: null, trackingNo: '452716978431', skuCode: 'K', skuName: '볼펜' },
        ]);
      },
    });
    await user.click(screen.getByRole('button', { name: '작업 시작' }));
    expect(await screen.findByText('적치 대기 중인 상품')).toBeInTheDocument();
    expect(screen.getByText('4527-1697-8431 · 볼펜 2개 중 2개 부족')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '작업 시작' })).toBeEnabled();
  });

  it('막힌 박스를 빼고 나머지로 시작하면 막힌 박스만 빼고 다시 시작한다', async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    let starts = 0;
    const onStarted = vi.fn();
    const { user } = mount({
      onStarted,
      request: async (o) => {
        calls.push({ path: o.path, body: o.body });
        if (o.path !== '/picking/v2/starts') return {};
        starts += 1;
        if (starts <= 2) {
          throw new ConflictError('m', 'BATCH_START_BLOCKED', undefined, [
            { shipmentId: 's9', reason: 'WAYBILL_NOT_READY', shipmentLineId: null, skuId: null, requiredQty: null, shortQty: null, detail: 'x', orderNos: ['1001'], trackingNo: null, skuCode: null, skuName: null },
          ]);
        }
        return { state: 'started', batchId: 'b-1', sessionId: 'x' };
      },
    });
    await user.click(screen.getByRole('button', { name: '작업 시작' }));
    expect(await screen.findByText('주문 1001 · 송장 재발급 필요')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '막힌 박스 1개 빼고 나머지로 시작' }));
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith({ removed: 1, uncertain: 0 }));
    expect(calls.map((c) => c.path)).toEqual([
      '/picking/v2/starts',
      '/picking/v2/starts',
      '/outbound-batches/b-1/shipments/s9',
      '/picking/v2/starts',
    ]);
    expect(screen.queryByText('시작하지 못했어요 — 아래 박스를 먼저 처리해 주세요')).not.toBeInTheDocument();
  });
});

describe('StartBatchButton 뺀 박스 수', () => {
  it('빼고 다시 시작했는데 또 막히면 뺀 수를 들고 있다가, 다음 시작이 되면 함께 넘긴다', async () => {
    const s9 = { shipmentId: 's9', reason: 'WAYBILL_NOT_READY', shipmentLineId: null, skuId: null, requiredQty: null, shortQty: null, detail: 'x', orderNos: ['1001'], trackingNo: null, skuCode: null, skuName: null };
    const s8 = { ...s9, shipmentId: 's8', orderNos: ['1002'] };
    const answers: Array<unknown[] | 'ok'> = [[s9], [s9], [s8], 'ok'];
    const onStarted = vi.fn();
    const { user } = mount({
      onStarted,
      request: async (o) => {
        if (o.path !== '/picking/v2/starts') return {};
        const next = answers.shift();
        if (next === 'ok' || next === undefined) return { state: 'started', batchId: 'b-1', sessionId: 'x' };
        throw new ConflictError('m', 'BATCH_START_BLOCKED', undefined, next);
      },
    });
    await user.click(screen.getByRole('button', { name: '작업 시작' }));
    await user.click(await screen.findByRole('button', { name: '막힌 박스 1개 빼고 나머지로 시작' }));
    expect(await screen.findByText('주문 1002 · 송장 재발급 필요')).toBeInTheDocument();
    expect(screen.getByText('이미 뺀 박스 1개는 관리자 화면 출고 준비로 돌아갔어요.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '작업 시작' }));
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith({ removed: 1, uncertain: 0 }));
  });
});

describe('StartBatchButton 결과를 모르는 박스', () => {
  it('결과를 몰랐던 박스가 다음 시도에서 빠지면 확인할 일에서 지운다', async () => {
    const s9 = { shipmentId: 's9', reason: 'WAYBILL_NOT_READY', shipmentLineId: null, skuId: null, requiredQty: null, shortQty: null, detail: 'x', orderNos: ['1001'], trackingNo: null, skuCode: null, skuName: null };
    const starts: Array<unknown[] | 'ok'> = [[s9], [s9], [s9], [s9], 'ok'];
    let deletes = 0;
    const onStarted = vi.fn();
    const { user } = mount({
      onStarted,
      request: async (o) => {
        if (o.path === '/picking/v2/starts') {
          const next = starts.shift();
          if (next === 'ok' || next === undefined) return { state: 'started', batchId: 'b-1', sessionId: 'x' };
          throw new ConflictError('m', 'BATCH_START_BLOCKED', undefined, next);
        }
        deletes += 1;
        if (deletes === 1) throw new ConflictError('처리 중', 'FULFILLMENT_COMMAND_IN_PROGRESS');
        return {};
      },
    });
    await user.click(screen.getByRole('button', { name: '작업 시작' }));
    await user.click(await screen.findByRole('button', { name: '막힌 박스 1개 빼고 나머지로 시작' }));
    await user.click(await screen.findByRole('button', { name: '막힌 박스 1개 빼고 나머지로 시작' }));
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith({ removed: 1, uncertain: 0 }));
  });
});

describe('RemovedOnStartNotice', () => {
  it('뺀 박스·결과를 모르는 박스가 있을 때만 알린다', () => {
    const { rerender } = render(<RemovedOnStartNotice outcome={{ removed: 0, uncertain: 0 }} />);
    expect(screen.queryByRole('status')).toBeNull();
    rerender(<RemovedOnStartNotice outcome={{ removed: 2, uncertain: 0 }} />);
    expect(screen.getByRole('status').textContent).toBe('막힌 박스 2개를 빼고 시작했어요. 뺀 박스는 관리자 화면 출고 준비로 돌아가요.');
    rerender(<RemovedOnStartNotice outcome={{ removed: 1, uncertain: 1 }} />);
    expect(screen.getByRole('status').textContent).toBe(
      '막힌 박스 1개를 빼고 시작했어요. 뺀 박스는 관리자 화면 출고 준비로 돌아가요. 박스 1개는 빠졌는지 확인하지 못했어요 — 배치 박스 목록에서 확인해 주세요.',
    );
  });
});
