import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BatchPickList } from '../../domains/outbound/pickList';
import {
  createOutboundServer,
  createTestRuntime,
} from '../outbound/__fixtures__/outboundServer';
import {
  BOX1,
  renderStation,
  stationPrefs,
} from '../outbound/__fixtures__/renderStation';
import { PickListScreen } from './PickListScreen';

const LIST: BatchPickList = {
  batchId: 'b-1',
  batchNumber: 'B-1002',
  startedAt: '2026-10-02T00:00:00.000Z',
  boxes: 3,
  rows: [
    {
      locationCode: 'A-01-1',
      skuId: 'sku-1',
      skuCode: 'SKU-1',
      skuName: '샴푸',
      qty: 4,
      pickedQty: 0,
      boxes: 2,
    },
    {
      locationCode: 'A-02-3',
      skuId: 'sku-2',
      skuCode: 'SKU-2',
      skuName: '린스',
      qty: 3,
      pickedQty: 1,
      boxes: 2,
    },
    {
      locationCode: 'B-10-1',
      skuId: 'sku-3',
      skuCode: 'SKU-3',
      skuName: '빗',
      qty: 1,
      pickedQty: 1,
      boxes: 1,
    },
  ],
};

function setup(opts: { list?: BatchPickList | null; fail?: boolean } = {}) {
  const server = createOutboundServer({ boxes: [BOX1] });
  if (opts.list !== null) server.config.pickLists['b-1'] = opts.list ?? LIST;
  server.config.pickListFail = opts.fail ?? false;
  const runtime = createTestRuntime(server);
  const view = renderStation(() => <PickListScreen batchId="b-1" />, {
    runtime,
    prefs: stationPrefs(),
  });
  return { server, ...view };
}

afterEach(() => vi.restoreAllMocks());

describe('배치 피킹 목록', () => {
  it('위치 순서대로 위치·상품·남은 수량·상자 수를 보이고, 다 집은 줄은 «다 집음»', async () => {
    setup();
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(
      rows.map((row) => within(row).getAllByRole('cell')[1].textContent)
    ).toEqual(['A-01-1', 'A-02-3', 'B-10-1']);
    expect(rows[0]).toHaveTextContent('샴푸');
    expect(rows[0]).toHaveTextContent('SKU-1');
    expect(within(rows[0]).getAllByRole('cell')[3]).toHaveTextContent('4');
    expect(within(rows[1]).getAllByRole('cell')[3]).toHaveTextContent('2');
    expect(rows[1]).toHaveTextContent('3개 중 1 집음');
    expect(within(rows[2]).getAllByRole('cell')[3]).toHaveTextContent(
      '다 집음'
    );
    expect(screen.getByText(/상자 3개 · 집을 수량 6개/)).toBeInTheDocument();
    expect(
      screen.getByText('수량은 이미 집은 것을 뺀 남은 수량이에요.')
    ).toBeInTheDocument();
  });

  it('아무것도 안 집었으면 남은 수량 안내를 붙이지 않는다', async () => {
    setup({
      list: {
        ...LIST,
        rows: LIST.rows.map((row) => ({ ...row, pickedQty: 0 })),
      },
    });
    await screen.findByRole('table');
    expect(
      screen.queryByText('수량은 이미 집은 것을 뺀 남은 수량이에요.')
    ).toBeNull();
  });

  it('«인쇄»는 OS 인쇄 대화상자를 연다', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    setup();
    fireEvent.click(await screen.findByRole('button', { name: '인쇄' }));
    expect(print).toHaveBeenCalledTimes(1);
  });

  it('다시 받는 동안엔 인쇄를 막고, 다시 받기가 실패하면 인쇄 단추를 거둔다 — 옛 목록을 뽑지 않게', async () => {
    const { server, queryClient } = setup();
    await screen.findByRole('button', { name: '인쇄' });
    let release = () => {};
    server.config.pickListGate = new Promise<void>(
      (resolve) => (release = resolve)
    );
    server.config.pickListFail = true;
    void queryClient.invalidateQueries({
      queryKey: ['batch-pick-list', 'b-1'],
    });
    expect(
      await screen.findByRole('button', { name: '목록 확인 중…' })
    ).toBeDisabled();
    expect(screen.getByRole('table').closest('.print\\:hidden')).not.toBeNull();
    release();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '피킹 목록을 불러오지 못했어요.'
    );
    expect(screen.queryByRole('button', { name: '인쇄' })).toBeNull();
    expect(screen.getByRole('table').closest('.print\\:hidden')).not.toBeNull();
    expect(
      screen.getByText(/다시 확인하지 못해 인쇄하지 않았어요/)
    ).toBeInTheDocument();
  });

  it('오프라인이라 다시 받기가 멈춰 있어도 확인되지 않은 목록이라 인쇄를 막는다', async () => {
    const { queryClient } = setup();
    await screen.findByRole('button', { name: '인쇄' });
    onlineManager.setOnline(false);
    try {
      void queryClient.invalidateQueries({
        queryKey: ['batch-pick-list', 'b-1'],
      });
      expect(
        await screen.findByRole('button', { name: '목록 확인 중…' })
      ).toBeDisabled();
      expect(
        screen.getByRole('table').closest('.print\\:hidden')
      ).not.toBeNull();
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it('확인된 목록은 인쇄에서 빼지 않는다', async () => {
    setup();
    const table = await screen.findByRole('table');
    await screen.findByRole('button', { name: '인쇄' });
    expect(table.closest('.print\\:hidden')).toBeNull();
  });

  it('시작 전 배치면 작업을 시작하라고 안내하고 인쇄 단추가 없다', async () => {
    setup({ list: { ...LIST, startedAt: null, boxes: 0, rows: [] } });
    expect(
      await screen.findByText(/작업을 시작해야 피킹 목록이 생겨요/)
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '인쇄' })).toBeNull();
  });

  it('집을 상품이 남지 않았으면 그렇게 말한다', async () => {
    setup({ list: { ...LIST, boxes: 0, rows: [] } });
    expect(
      await screen.findByText('이 배치에는 집을 상품이 남아 있지 않아요.')
    ).toBeInTheDocument();
  });

  it('조회가 실패하면 실패를 알리고, 다시 확인하면 목록을 보인다', async () => {
    const { server } = setup({ fail: true });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '피킹 목록을 불러오지 못했어요.'
    );
    server.config.pickListFail = false;
    fireEvent.click(screen.getByRole('button', { name: '다시 확인' }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });

  it('«배치 현황으로»는 보던 배치를 들고 F2 로 돌아간다', async () => {
    const { router } = setup();
    fireEvent.click(
      await screen.findByRole('button', { name: '배치 현황으로' })
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/outbound/batches')
    );
    expect(router.state.location.state.batchId).toBe('b-1');
  });
});
