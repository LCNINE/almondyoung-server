import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import {
  BARCODE_LABEL_PRINTER_KEY,
  LABEL_PRINTER_KEY,
  NO_LABEL_PRINTER_MESSAGE,
  PrinterError,
} from '../../core/hardware/print/labelPrinter';
import { SkuLabelPrintPanel } from './SkuLabelPrintPanel';
import { SKU_LABEL_SIZE_KEY } from './usePrintLabels';
import type { LabelBatch } from './labelApi';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

const DETAIL = {
  id: 'sku-1',
  code: 'CT-001',
  name: '코튼셔츠',
  safetyStock: 0,
  barcodes: [
    { id: 'b1', barcode: '111', isPrimary: false },
    { id: 'b2', barcode: '8801234567890', isPrimary: true },
  ],
};
const OK: LabelBatch = { format: 'zpl', data: '^XA^XZ', labels: 3, skipped: [] };

function setup(opts: { batch?: LabelBatch; prefs?: Record<string, string>; print?: () => Promise<void> } = {}) {
  const labelCalls: unknown[] = [];
  const request = vi.fn(async (o: { path: string; body?: unknown }) => {
    if (o.path === '/inventory/skus/sku-1') return DETAIL;
    labelCalls.push(o.body);
    return opts.batch ?? OK;
  });
  const client = { request } as unknown as ApiClient;
  const prefs = createMemoryPrefs(opts.prefs ?? { [BARCODE_LABEL_PRINTER_KEY]: 'spooler://TX400' });
  const print = vi.fn(opts.print ?? (async () => {}));
  const ui = () => (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SessionProvider session={session}>
        <ApiClientProvider client={client}>
          <SkuLabelPrintPanel skuId="sku-1" prefs={prefs} print={print} />
        </ApiClientProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
  return { ui, labelCalls, print, prefs };
}

describe('SkuLabelPrintPanel', () => {
  it('대표 바코드를 «찍힐 바코드» 로 보인다', async () => {
    render(setup().ui());
    expect(await screen.findByText('8801234567890')).toBeInTheDocument();
  });

  it('라벨 칸이 비고 송장 칸만 있으면 서버도 프린터도 부르지 않고 안내한다', async () => {
    const { ui, labelCalls, print } = setup({ prefs: { [LABEL_PRINTER_KEY]: 'spooler://XP' } });
    render(ui());
    await userEvent.click(screen.getByRole('button', { name: '라벨 출력' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(NO_LABEL_PRINTER_MESSAGE);
    expect(labelCalls).toHaveLength(0);
    expect(print).not.toHaveBeenCalled();
  });

  it('같은 틱에 두 번 눌러도 인쇄는 한 번이다', async () => {
    const { ui, print } = setup();
    render(ui());
    const button = screen.getByRole('button', { name: '라벨 출력' });
    button.click();
    button.click();
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('라벨 3장을 보냈어요')).toBeInTheDocument();
    expect(print).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('찍을 라벨이 없어요')).not.toBeInTheDocument();
  });

  it('data 가 비고 NO_BARCODE 면 인쇄하지 않고 사유를 보인다', async () => {
    const { ui, print } = setup({
      batch: { format: 'zpl', data: '', labels: 0, skipped: [{ ref: 'sku-1', code: null, reason: 'NO_BARCODE' }] },
    });
    render(ui());
    await userEvent.click(screen.getByRole('button', { name: '라벨 출력' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('등록된 바코드가 없어요');
    expect(print).not.toHaveBeenCalled();
  });

  it('바코드가 넓을 때 1×3 이면 3×5 를 권하고 3×5 면 권하지 않는다', async () => {
    const wide: LabelBatch = {
      format: 'zpl',
      data: '',
      labels: 0,
      skipped: [{ ref: 'sku-1', code: null, reason: 'BARCODE_TOO_WIDE' }],
    };
    const small = setup({ batch: wide });
    render(small.ui());
    await userEvent.click(screen.getByRole('button', { name: '1×3' }));
    await userEvent.click(screen.getByRole('button', { name: '라벨 출력' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('바코드가 길어 1×3 에 안 들어가요. 3×5 를 쓰세요');
    await userEvent.click(screen.getByRole('button', { name: '3×5' }));
    await userEvent.click(screen.getByRole('button', { name: '라벨 출력' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('바코드가 길어 라벨에 안 들어가요'),
    );
  });

  it('크기를 1×3 으로 바꾸면 30x10 으로 요청하고 다시 열어도 1×3 이다', async () => {
    const { ui, labelCalls, prefs } = setup();
    const first = render(ui());
    await userEvent.click(screen.getByRole('button', { name: '1×3' }));
    await userEvent.click(screen.getByRole('button', { name: '라벨 출력' }));
    await screen.findByText('라벨 3장을 보냈어요');
    expect(labelCalls[0]).toEqual({ size: '30x10', items: [{ skuId: 'sku-1', copies: 1 }] });
    expect(prefs.get(SKU_LABEL_SIZE_KEY)).toBe('30x10');
    first.unmount();
    render(ui());
    expect(screen.getByRole('button', { name: '1×3' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('기본 크기는 3×5 이고 장수 3 이면 copies 3 으로 요청한다', async () => {
    const { ui, labelCalls } = setup();
    render(ui());
    expect(screen.getByRole('button', { name: '3×5' })).toHaveAttribute('aria-pressed', 'true');
    const input = screen.getByLabelText('장수');
    await userEvent.clear(input);
    await userEvent.type(input, '3');
    await userEvent.click(screen.getByRole('button', { name: '라벨 출력' }));
    await screen.findByText('라벨 3장을 보냈어요');
    expect(labelCalls[0]).toEqual({ size: '50x30', items: [{ skuId: 'sku-1', copies: 3 }] });
  });

  it('프린터 실패는 현장 문구와 원문을 보인다', async () => {
    const { ui } = setup({
      print: async () => {
        throw new PrinterError('OpenPrinterW failed: 1801');
      },
    });
    render(ui());
    await userEvent.click(screen.getByRole('button', { name: '라벨 출력' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('프린터로 보내지 못했어요');
    expect(alert).toHaveTextContent('OpenPrinterW failed: 1801');
  });
});
