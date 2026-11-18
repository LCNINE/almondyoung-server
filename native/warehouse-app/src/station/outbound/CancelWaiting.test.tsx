import 'fake-indexeddb/auto';
import { act, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FakeBox } from './__fixtures__/outboundServer';
import {
  BOX1,
  press,
  scan,
  setupInspection,
} from './__fixtures__/renderStation';

const WAITING: FakeBox = {
  ...BOX1,
  cancelWaiting: [{ shipmentLineId: 'l-2', qty: 1 }],
};
const panel = () => screen.getByRole('status', { name: '취소 대기' });

describe('취소를 기다리는 박스', () => {
  it('송장을 찍으면 검수 대신 취소 내용과 박스 빼기를 먼저 보여 준다', async () => {
    await setupInspection({ boxes: [WAITING] });
    scan(WAITING.trackingNo);

    expect(
      await screen.findByText('주문 일부가 취소된 박스예요')
    ).toBeInTheDocument();
    expect(panel()).toHaveTextContent('헤어클립 집게핀3 → 2');
    expect(panel()).toHaveTextContent('F11 을 두 번 눌러 박스를 빼 주세요');
    expect(document.querySelector('[data-intake="blocked"]')).not.toBeNull();
  });

  it('모든 줄이 취소되면 주문이 취소된 박스라고 한다', async () => {
    await setupInspection({
      boxes: [
        {
          ...BOX1,
          cancelWaiting: [
            { shipmentLineId: 'l-2', qty: 3 },
            { shipmentLineId: 'l-1', qty: 1 },
          ],
        },
      ],
    });
    scan(BOX1.trackingNo);

    expect(
      await screen.findByText('주문이 취소된 박스예요')
    ).toBeInTheDocument();
    expect(panel()).toHaveTextContent('컬러크림 6N1 → 0');
  });

  it('상품을 찍어도 보내지 않고 이유를 알린다', async () => {
    const { server } = await setupInspection({ boxes: [WAITING] });
    scan(WAITING.trackingNo);
    await screen.findByText('주문 일부가 취소된 박스예요');
    // 박스 화면의 손잡이가 걸린 뒤에 찍는다
    await act(async () => {});

    scan('8801002');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '취소를 기다리는 박스라 상품을 받지 않아요'
    );
    expect(server.scans).toHaveLength(0);
  });

  it('F11 두 번이면 배치에서 뺀다', async () => {
    const { server } = await setupInspection({ boxes: [WAITING] });
    scan(WAITING.trackingNo);
    await screen.findByText('주문 일부가 취소된 박스예요');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /박스 빼기/ })).toBeEnabled()
    );

    press('F11');
    press('F11');

    await waitFor(() =>
      expect(server.excludes).toEqual([
        expect.objectContaining({ shipmentId: WAITING.shipmentId }),
      ])
    );
  });

  it('취소 내용을 싣지 않는 옛 core 면 지금처럼 검수한다', async () => {
    const { server } = await setupInspection({
      boxes: [{ ...BOX1, cancelWaiting: [], legacy: true }],
    });
    scan(BOX1.trackingNo);
    await waitFor(() =>
      expect(document.querySelector('[data-intake="open"]')).not.toBeNull()
    );

    scan('8801002');

    await waitFor(() => expect(server.scans).toHaveLength(1));
  });
});
