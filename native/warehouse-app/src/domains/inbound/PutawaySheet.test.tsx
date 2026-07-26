import { describe, it, expect, vi } from 'vitest';
import type { ComponentProps, ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import { ScanProvider } from '../../core/hardware/scan/ScanProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import type { PutawayTarget } from './types';
import { PutawaySheet } from './PutawaySheet';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

const TARGET: PutawayTarget = {
  lineId: 'ln-1',
  skuCode: 'CT-001',
  skuName: '코튼셔츠',
  pendingQty: 50,
  originLocationCode: '입고기본존',
  originLocationId: 'l-origin',
};

interface Call {
  path: string;
  method?: string;
  body?: unknown;
  idempotencyKey?: string;
}

function makeClient(calls: Call[], opts: { failPutawayOnce?: boolean } = {}): ApiClient {
  let putawayAttempts = 0;
  return {
    request: (async (o: Call) => {
      calls.push(o);
      if (o.path.startsWith('/locations/warehouses/')) {
        // 검색어는 한글일 수 있어 URLSearchParams 가 percent-encode 한다 — 디코드해서 비교한다.
        const path = decodeURIComponent(o.path);
        if (path.includes('입고기본존')) {
          return {
            items: [
              { id: 'l-origin', code: '입고기본존', displayName: '입고기본존' },
              { id: 'l-dst', code: 'B-05-03', displayName: 'B-05-03' },
            ],
            total: 2,
          };
        }
        if (path.includes('B-05')) {
          return { items: [{ id: 'l-dst', code: 'B-05-03', displayName: 'B-05-03' }], total: 1 };
        }
        if (path.includes('C-09')) {
          return { items: [{ id: 'l-dst2', code: 'C-09-01', displayName: 'C-09-01' }], total: 1 };
        }
        if (path.includes('INB')) {
          return {
            items: [
              { id: 'l-origin', code: '입고기본존', displayName: '입고기본존' },
              { id: 'l-dst', code: 'B-05-03', displayName: 'B-05-03' },
            ],
            total: 2,
          };
        }
        // 출발지 하나만 검색되는 검색어 — 결과가 있었는데 출발지 제외로 비는
        // 경우를 재현한다("못 찾음"과 구분해야 하는 케이스).
        if (path.includes('ONLYORIGIN')) {
          return {
            items: [{ id: 'l-origin', code: '입고기본존', displayName: '입고기본존' }],
            total: 1,
          };
        }
        return { items: [], total: 0 };
      }
      if (o.path === '/inbound/putaway') {
        putawayAttempts += 1;
        if (opts.failPutawayOnce && putawayAttempts === 1) {
          throw new Error('POST /inbound/putaway → 500');
        }
        return { success: true };
      }
      throw new Error(`GET ${o.path} → 404`);
    }) as unknown as ApiClient['request'],
  };
}

function renderSheet(
  props: Partial<ComponentProps<typeof PutawaySheet>> = {},
  calls: Call[] = [],
  clientOpts: { failPutawayOnce?: boolean } = {}
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={makeClient(calls, clientOpts)}>
          <ScanProvider>{children}</ScanProvider>
        </ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  const onDone = props.onDone ?? vi.fn();
  const onCancel = props.onCancel ?? vi.fn();
  const view = render(
    <PutawaySheet
      target={props.target ?? TARGET}
      warehouseId={props.warehouseId ?? 'w-1'}
      lastDest={props.lastDest ?? null}
      onDone={onDone}
      onCancel={onCancel}
    />,
    { wrapper }
  );
  return { onDone, onCancel, rerender: view.rerender };
}

describe('PutawaySheet', () => {
  it('코드 완전일치 단건이면 대상지를 자동 선택한다', async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.type(screen.getByLabelText('대상 로케이션 검색'), 'B-05-03');

    await waitFor(() => expect(screen.getByText('B-05-03')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: '적치' })).toBeEnabled());
  });

  it('직전 대상지 버튼으로 한 번에 고른다', async () => {
    const user = userEvent.setup();
    renderSheet({ lastDest: { id: 'l-prev', code: 'A-01-01' } });

    await user.click(screen.getByRole('button', { name: '직전 대상지 A-01-01 사용' }));

    await waitFor(() => expect(screen.getByRole('button', { name: '적치' })).toBeEnabled());
  });

  it('적치하면 lineId·대상지·수량을 보내고 onDone 을 부른다', async () => {
    const user = userEvent.setup();
    const calls: Call[] = [];
    const { onDone } = renderSheet({ lastDest: { id: 'l-prev', code: 'A-01-01' } }, calls);

    await user.click(screen.getByRole('button', { name: '직전 대상지 A-01-01 사용' }));
    await user.click(screen.getByRole('button', { name: '적치' }));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ id: 'l-prev', code: 'A-01-01' }, 50));
    const putaway = calls.find((c) => c.path === '/inbound/putaway');
    expect(putaway?.body).toMatchObject({ lineId: 'ln-1', toLocationId: 'l-prev', quantity: 50 });
  });

  it('대상지를 안 고르면 적치할 수 없다', () => {
    renderSheet();
    expect(screen.getByRole('button', { name: '적치' })).toBeDisabled();
  });

  it('대상지를 바꿔 재제출하면 멱등키가 회전한다', async () => {
    const user = userEvent.setup();
    const calls: Call[] = [];
    renderSheet({}, calls);

    await user.type(screen.getByLabelText('대상 로케이션 검색'), 'B-05-03');
    await waitFor(() => expect(screen.getByRole('button', { name: '적치' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: '적치' }));

    const putawayCalls = () => calls.filter((c) => c.path === '/inbound/putaway');
    await waitFor(() => expect(putawayCalls()).toHaveLength(1));
    const [first] = putawayCalls();
    expect(first.idempotencyKey).toBeTruthy();
    expect(first.body).toMatchObject({ toLocationId: 'l-dst', idempotencyKey: first.idempotencyKey });

    await user.click(screen.getByRole('button', { name: '변경' }));
    await user.type(screen.getByLabelText('대상 로케이션 검색'), 'C-09-01');
    await waitFor(() => expect(screen.getByRole('button', { name: '적치' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: '적치' }));

    await waitFor(() => expect(putawayCalls()).toHaveLength(2));
    const [, second] = putawayCalls();
    expect(second.idempotencyKey).toBeTruthy();
    expect(second.body).toMatchObject({ toLocationId: 'l-dst2', idempotencyKey: second.idempotencyKey });
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it('값이 안 바뀐 재시도는 같은 멱등키를 유지한다', async () => {
    const user = userEvent.setup();
    const calls: Call[] = [];
    renderSheet({ lastDest: { id: 'l-prev', code: 'A-01-01' } }, calls, { failPutawayOnce: true });

    await user.click(screen.getByRole('button', { name: '직전 대상지 A-01-01 사용' }));
    await user.click(screen.getByRole('button', { name: '적치' }));

    const putawayCalls = () => calls.filter((c) => c.path === '/inbound/putaway');
    await waitFor(() => expect(putawayCalls()).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    const [first] = putawayCalls();

    // 값(대상지)을 고치지 않고 그대로 재제출 — 실패한 요청의 재시도.
    await user.click(screen.getByRole('button', { name: '적치' }));
    await waitFor(() => expect(putawayCalls()).toHaveLength(2));
    const [, second] = putawayCalls();

    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(second.body).toMatchObject({ idempotencyKey: first.idempotencyKey });
  });

  it('target 이 바뀌면(언마운트 없이) 이전 라인의 대상지가 새 라인에 남지 않는다', async () => {
    const user = userEvent.setup();
    const { rerender } = renderSheet({ lastDest: { id: 'l-prev', code: 'A-01-01' } });

    await user.click(screen.getByRole('button', { name: '직전 대상지 A-01-01 사용' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '적치' })).toBeEnabled());

    // 대상지뿐 아니라 수량도 라인 A 에서 건드린다 — 65번 줄(리셋)이 없으면
    // 이 501 이 라인 B 프리필로 새어 들어간다. NumberPad 는 자릿수를 누적하므로
    // 50 에서 '1' 을 누르면 501 이 된다.
    await user.click(screen.getByRole('button', { name: '1' }));
    expect(screen.getByText('501', { selector: 'output' })).toBeInTheDocument();

    const nextTarget: PutawayTarget = { ...TARGET, lineId: 'ln-2', skuCode: 'CT-002', skuName: '린넨팬츠' };
    rerender(
      <PutawaySheet
        target={nextTarget}
        warehouseId="w-1"
        lastDest={{ id: 'l-prev', code: 'A-01-01' }}
        onDone={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: '적치' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '직전 대상지 A-01-01 사용' })).toBeInTheDocument();
    expect(screen.queryByText('A-01-01', { selector: 'span' })).not.toBeInTheDocument();
    // 새 라인의 잔여(50)로 프리필이 복원됐다 — 501 이 새지 않았다.
    expect(screen.getByText('50', { selector: 'output' })).toBeInTheDocument();
  });

  it('잔여 수량을 프리필하고 초과 입력이면 적치를 막는다', async () => {
    const user = userEvent.setup();
    renderSheet({ lastDest: { id: 'l-prev', code: 'A-01-01' } });

    expect(screen.getByText(/입고기본존 · 잔여 50개/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '직전 대상지 A-01-01 사용' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '적치' })).toBeEnabled());

    // NumberPad 는 자릿수를 누적한다 — 50 에서 1 을 누르면 501 이 되어 잔여를 넘는다.
    await user.click(screen.getByRole('button', { name: '1' }));
    expect(screen.getByRole('button', { name: '적치' })).toBeDisabled();
  });

  it('출발지는 대상 로케이션 후보에서 제외한다', async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.type(screen.getByLabelText('대상 로케이션 검색'), 'INB');

    expect(await screen.findByRole('button', { name: 'B-05-03' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '입고기본존' })).not.toBeInTheDocument();
  });

  it('검색 결과가 출발지뿐이면 못 찾음이 아니라 출발지라고 알린다', async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.type(screen.getByLabelText('대상 로케이션 검색'), 'ONLYORIGIN');

    expect(await screen.findByText('여기가 출발지예요. 다른 로케이션을 고르세요.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '입고기본존' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '적치' })).toBeDisabled();
  });

  it('검색 결과가 0건이면 출발지 안내 문구를 보여주지 않는다', async () => {
    // R1 의 구분(rawLocationResults.length > 0 이 onlyOriginMatched 의 조건)을
    // 대조 케이스로 고정한다 — "진짜 못 찾음"과 "결과는 있는데 전부 출발지"는
    // 다른 사실이라 서로 다른 문구를 써야 하고, 이 테스트는 전자에서 후자의
    // 문구가 새지 않음을 잠근다.
    const user = userEvent.setup();
    const calls: Call[] = [];
    renderSheet({}, calls);

    await user.type(screen.getByLabelText('대상 로케이션 검색'), 'NOWHERE-XYZ');

    // 검색 요청이 실제로 나가고(응답은 0건) 화면에 반영될 시간을 준 뒤에
    // 확인한다 — 안 그러면 "아직 응답 전이라 그냥 안 보임"과 구분이 안 된다.
    await waitFor(() =>
      expect(calls.some((c) => c.path.includes('NOWHERE-XYZ'))).toBe(true)
    );
    await waitFor(() =>
      expect(screen.queryByText('여기가 출발지예요. 다른 로케이션을 고르세요.')).not.toBeInTheDocument()
    );
  });

  it('출발지 코드를 정확히 입력해도 자동선택되지 않는다', async () => {
    const user = userEvent.setup();
    renderSheet();

    // 완전일치 대상(코드 == 검색어)이 바로 출발지 자신이다 — 목록 필터(:151)와
    // 별개로 자동선택 로직(:50-52)도 출발지를 제외해야 한다.
    await user.type(screen.getByLabelText('대상 로케이션 검색'), '입고기본존');

    await waitFor(() => expect(screen.getByRole('button', { name: 'B-05-03' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: '입고기본존' })).not.toBeInTheDocument();
    // 자동선택됐다면 검색 목록 자체가 "선택된 대상지" 배지로 바뀌어 있을 것이다.
    expect(screen.getByRole('button', { name: '적치' })).toBeDisabled();
  });

  it('수량을 바꾸면 멱등키가 회전한다', async () => {
    const user = userEvent.setup();
    const calls: Call[] = [];
    renderSheet({ lastDest: { id: 'l-prev', code: 'A-01-01' } }, calls);

    await user.click(screen.getByRole('button', { name: '직전 대상지 A-01-01 사용' }));
    await user.click(screen.getByRole('button', { name: '적치' }));

    // 같은 라인·같은 대상지인데 수량만 바꿔 재제출한다.
    // 50 → 지우기 → 5 → 지우기 → 0 → '3' → 3.
    await user.click(screen.getByRole('button', { name: '지우기' }));
    await user.click(screen.getByRole('button', { name: '지우기' }));
    await user.click(screen.getByRole('button', { name: '3' }));
    await user.click(screen.getByRole('button', { name: '적치' }));

    const putaways = calls.filter((c) => c.path === '/inbound/putaway');
    expect(putaways).toHaveLength(2);
    expect(putaways[0].idempotencyKey).not.toBe(putaways[1].idempotencyKey);
    expect(putaways[1].body).toMatchObject({ quantity: 3 });
  });
});
