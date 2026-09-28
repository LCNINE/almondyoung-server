import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import { ConflictError, type ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { LABEL_PRINTER_KEY, PrinterError } from '../../core/hardware/print/labelPrinter';
import { ReprintLabelButton } from './ReprintLabelButton';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

function mount(opts: {
  respond: (path: string) => Promise<unknown>;
  print?: (target: string, text: string) => Promise<void>;
  printer?: string | null;
}) {
  const paths: string[] = [];
  const client: ApiClient = {
    request: (async (o: { path: string }) => {
      paths.push(o.path);
      return opts.respond(o.path);
    }) as unknown as ApiClient['request'],
  };
  const prefs = createMemoryPrefs(
    opts.printer === null ? {} : { [LABEL_PRINTER_KEY]: opts.printer ?? 'spooler://XP' }
  );
  const print = vi.fn(opts.print ?? (async () => {}));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={new QueryClient()}>
        <ApiClientProvider client={client}>{children}</ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  render(<ReprintLabelButton shipmentId="s-1" prefs={prefs} print={print} />, { wrapper });
  return { paths, print };
}

const label = { waybillId: 'w', trackingNo: 'T-1', format: 'zpl', data: '^XA^XZ' };

describe('ReprintLabelButton', () => {
  it('라벨을 받아 설정된 프린터로 보낸다', async () => {
    const { paths, print } = mount({ respond: async () => label });
    await userEvent.click(screen.getByRole('button', { name: '라벨 재출력' }));
    expect(await screen.findByRole('status')).toHaveTextContent('T-1');
    expect(paths).toEqual(['/shipments/s-1/waybill/label']);
    expect(print).toHaveBeenCalledWith('spooler://XP', '^XA^XZ');
  });

  it('409 는 현장 문구로', async () => {
    mount({
      respond: async () => {
        throw new ConflictError('WAYBILL_STALE: waybill w changed', 'CONFLICT');
      },
    });
    await userEvent.click(screen.getByRole('button', { name: '라벨 재출력' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('재발급을 요청해 주세요');
  });

  it('프린터 실패는 원문을 함께 보인다', async () => {
    mount({
      respond: async () => label,
      print: async () => {
        throw new PrinterError('OpenPrinterW failed: 1801');
      },
    });
    await userEvent.click(screen.getByRole('button', { name: '라벨 재출력' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('프린터로 보내지 못했어요');
    expect(alert).toHaveTextContent('OpenPrinterW failed: 1801');
  });

  it('프린터 미설정이면 API 를 부르지 않고 안내한다', async () => {
    const { paths } = mount({ respond: async () => label, printer: null });
    await userEvent.click(screen.getByRole('button', { name: '라벨 재출력' }));
    expect(screen.getByRole('alert')).toHaveTextContent('설정에서 지정해 주세요');
    expect(paths).toEqual([]);
  });

  it('인쇄 중 연타해도 한 번만 부른다', async () => {
    let release: (v: unknown) => void = () => {};
    const { paths } = mount({
      respond: () => new Promise((resolve) => (release = resolve)),
    });
    const button = screen.getByRole('button', { name: '라벨 재출력' });
    await userEvent.click(button);
    await userEvent.click(button);
    release(label);
    expect(await screen.findByRole('status')).toHaveTextContent('T-1');
    expect(paths).toHaveLength(1);
  });
});
