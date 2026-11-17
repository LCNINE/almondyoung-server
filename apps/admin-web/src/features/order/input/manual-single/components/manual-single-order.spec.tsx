/**
 * @jest-environment jsdom
 */
import { randomUUID } from 'node:crypto';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  MasterSummaryDto,
  VariantPreviewDto,
} from '@/lib/types/dto/products';

type QueryState<T> = {
  data: T | undefined;
  isPending: boolean;
  isError: boolean;
  refetch: jest.Mock;
};

const mockMasters = jest.fn<
  QueryState<{ data: MasterSummaryDto[]; total: number }>,
  [unknown]
>();
const mockVariantRows = jest.fn<QueryState<unknown>, [string, unknown]>();
type BatchState = {
  data: Map<string, { optionLabel?: string }> | undefined;
  isPending?: boolean;
  isError?: boolean;
  refetch?: jest.Mock;
};
const mockVariantsBatch = jest.fn<BatchState, [string[]]>(() => ({
  data: undefined,
}));
const mockPush = jest.fn();
type MutateOptions = {
  onSuccess: () => void;
  onError: (err: unknown) => void;
};
const mockMutate = jest.fn<void, [unknown, MutateOptions]>();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/lib/services/products', () => ({
  useMastersSummary: (q: unknown) => mockMasters(q),
  useVariantRowsByMaster: (masterId: string, opts: unknown) =>
    mockVariantRows(masterId, opts),
  useVariantsBatch: (ids: string[]) => mockVariantsBatch(ids),
  // 예전 화면이 쓰던 훅. 실제처럼 객체 인자를 읽는다.
  useMasters: (q: unknown) => mockMasters(q),
  useVariantsByMaster: (q: { masterId: string }) =>
    mockVariantRows(q.masterId, q),
}));

jest.mock('@/lib/services/orders', () => ({
  useCreateSalesOrder: () => ({ mutate: mockMutate, isPending: false }),
}));

jest.mock('@/components/common/address-search-dialog', () => ({
  AddressSearchDialog: () => null,
}));

jest.mock('./CustomerSearchDialog', () => ({
  CustomerSearchDialog: () => null,
}));

import { CustomError } from '@/lib/api/customError';
import ManualSingleOrderPage from './index';

const preview = (
  variantId: string,
  name: string,
  basePrice: number | null
): VariantPreviewDto => ({
  variantId,
  name,
  basePrice,
  membershipPrice: null,
  status: 'active',
});

const master = (over: Partial<MasterSummaryDto>): MasterSummaryDto =>
  ({
    masterId: 'master-a',
    versionId: 'version-a',
    name: '네일 젤',
    thumbnail: null,
    brand: null,
    productCode: 'NAIL-01',
    supplyPrice: null,
    supplierId: null,
    hideMembershipPriceForNonMembers: false,
    isVisibleToMembersOnly: false,
    isMembershipOnly: false,
    isOverseas: false,
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    optionGroupNames: ['색상'],
    variantCount: 2,
    variantPreviews: [
      preview('variant-red', '빨강', 1000),
      preview('variant-blue', '파랑', null),
    ],
    priceSummary: null,
    soldOutState: 'none',
    ...over,
  }) as MasterSummaryDto;

const ok = <T,>(data: T): QueryState<T> => ({
  data,
  isPending: false,
  isError: false,
  refetch: jest.fn(),
});

beforeAll(() => {
  if (typeof globalThis.crypto.randomUUID !== 'function') {
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      value: randomUUID,
    });
  }
});

beforeEach(() => {
  mockMasters.mockReset();
  mockVariantRows.mockReset();
  mockVariantsBatch.mockReset();
  mockMutate.mockReset();
  mockPush.mockReset();
  mockVariantsBatch.mockReturnValue({ data: undefined });
  mockVariantRows.mockReturnValue(
    ok({ data: [], total: 0, page: 1, limit: 100 })
  );
});

async function fillRecipientAndOpenSearch() {
  const user = userEvent.setup();
  render(<ManualSingleOrderPage />);
  const field = screen.getByText('수취인 성명').parentElement;
  const recipient = within(field as HTMLElement).getByRole('textbox');
  await user.type(recipient, '받는분');
  await user.click(screen.getByRole('button', { name: '상품명 검색' }));
  return { user, recipient };
}

describe('수동 주문 상품 검색', () => {
  it('옵션을 골라 주문상품에 담고 입력해 둔 값은 그대로 둔다', async () => {
    mockMasters.mockReturnValue(ok({ data: [master({})], total: 1 }));
    const { user, recipient } = await fillRecipientAndOpenSearch();

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('네일 젤')).toBeTruthy();
    expect(within(dialog).getByText('가격 없음')).toBeTruthy();
    // 미리보기로 충분한 상품은 옵션 API 를 따로 부르지 않는다.
    expect(mockVariantRows).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: /빨강/ }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('빨강')).toBeTruthy();
    expect(screen.getByDisplayValue('1000')).toBeTruthy();
    expect((recipient as HTMLInputElement).value).toBe('받는분');
  });

  it('가격을 모르는 옵션은 단가를 비워 두고 합계에서 뺐다고 알린다', async () => {
    mockMasters.mockReturnValue(ok({ data: [master({})], total: 1 }));
    const { user } = await fillRecipientAndOpenSearch();

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /파랑/ }));

    expect(
      (screen.getByPlaceholderText('단가 입력') as HTMLInputElement).value
    ).toBe('');
    expect(screen.getByText(/단가 미입력 1개 제외/)).toBeTruthy();
  });

  it('미리보기에 없는 옵션은 펼칠 때만 그 상품의 옵션을 부르고 이름과 가격을 유지한다', async () => {
    mockMasters.mockReturnValue(
      ok({
        data: [
          master({
            variantCount: 3,
            variantPreviews: [
              preview('variant-red', '빨강', 1000),
              preview('variant-free', '증정', 0),
            ],
          }),
        ],
        total: 1,
      })
    );
    // 이 목록은 수동 이름이 없으면 null, 가격이 없거나 0 이면 0 을 준다.
    mockVariantRows.mockReturnValue(
      ok({
        data: [
          {
            id: 'variant-red',
            variantName: null,
            price: 1000,
            status: 'active',
          },
          { id: 'variant-free', variantName: null, price: 0, status: 'active' },
          {
            id: 'variant-green',
            variantName: null,
            price: 0,
            status: 'active',
          },
        ],
        total: 3,
        page: 1,
        limit: 100,
      })
    );
    mockVariantsBatch.mockImplementation((ids) => ({
      data: new Map(
        ids.includes('variant-green')
          ? [['variant-green', { optionLabel: '초록' }]]
          : []
      ),
    }));
    const { user } = await fillRecipientAndOpenSearch();

    const dialog = await screen.findByRole('dialog');
    expect(mockVariantRows).not.toHaveBeenCalled();

    await user.click(
      within(dialog).getByRole('button', { name: '옵션 3개 모두 보기' })
    );

    expect(mockVariantRows).toHaveBeenCalledWith('master-a', {
      page: 1,
      limit: 100,
    });
    // 미리보기에 있던 옵션은 표시명을 다시 받지 않는다.
    expect(mockVariantsBatch).toHaveBeenLastCalledWith(['variant-green']);
    const red = within(dialog).getByRole('button', { name: /빨강/ });
    expect(within(red).getByText('1,000원')).toBeTruthy();
    const free = within(dialog).getByRole('button', { name: /증정/ });
    expect(within(free).getByText('0원')).toBeTruthy();
    const green = within(dialog).getByRole('button', { name: /초록/ });
    expect(within(green).getByText('가격 없음')).toBeTruthy();
  });

  it('옵션이 한 번에 받는 수보다 많으면 다음 옵션으로 넘겨 볼 수 있다', async () => {
    mockMasters.mockReturnValue(
      ok({ data: [master({ variantCount: 150 })], total: 1 })
    );
    mockVariantRows.mockImplementation((_id, opts) => {
      const { page } = opts as { page: number };
      // 범위 표시는 total 로 계산하므로 페이지마다 두 줄만 둔다.
      const start = (page - 1) * 100;
      return ok({
        data: Array.from({ length: 2 }, (_, i) => ({
          id: `variant-${start + i + 1}`,
          variantName: `옵션 ${start + i + 1}`,
          price: 500,
          status: 'active',
        })),
        total: 150,
        page,
        limit: 100,
      });
    });
    const { user } = await fillRecipientAndOpenSearch();

    const dialog = await screen.findByRole('dialog');
    await user.click(
      within(dialog).getByRole('button', { name: '옵션 150개 모두 보기' })
    );
    expect(within(dialog).getByText('1–100 / 150')).toBeTruthy();

    await user.click(within(dialog).getByRole('button', { name: '다음 옵션' }));

    expect(mockVariantRows).toHaveBeenLastCalledWith('master-a', {
      page: 2,
      limit: 100,
    });
    expect(within(dialog).getByText('101–150 / 150')).toBeTruthy();
    expect(
      (
        within(dialog).getByRole('button', {
          name: '다음 옵션',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);

    expect(within(dialog).getByText('옵션 101')).toBeTruthy();

    await user.click(within(dialog).getByRole('button', { name: '이전 옵션' }));
    expect(within(dialog).getByText('1–100 / 150')).toBeTruthy();
  });

  it('이름을 모르는 옵션은 이름을 받기 전에 고를 수 없다', async () => {
    mockMasters.mockReturnValue(
      ok({ data: [master({ variantCount: 3 })], total: 1 })
    );
    mockVariantRows.mockReturnValue(
      ok({
        data: [
          {
            id: 'variant-green',
            variantName: null,
            price: 0,
            status: 'active',
          },
        ],
        total: 3,
        page: 1,
        limit: 100,
      })
    );
    mockVariantsBatch.mockReturnValue({ data: undefined, isPending: true });
    const { user } = await fillRecipientAndOpenSearch();

    const dialog = await screen.findByRole('dialog');
    await user.click(
      within(dialog).getByRole('button', { name: '옵션 3개 모두 보기' })
    );
    expect(within(dialog).getByText('옵션 이름 불러오는 중...')).toBeTruthy();
    expect(
      within(dialog).queryByRole('button', { name: /이름 없음/ })
    ).toBeNull();
  });

  it('옵션 이름을 못 받으면 고르지 못하게 하고 다시 시도할 수 있다', async () => {
    mockMasters.mockReturnValue(
      ok({ data: [master({ variantCount: 3 })], total: 1 })
    );
    mockVariantRows.mockReturnValue(
      ok({
        data: [
          {
            id: 'variant-green',
            variantName: null,
            price: 0,
            status: 'active',
          },
        ],
        total: 3,
        page: 1,
        limit: 100,
      })
    );
    const refetch = jest.fn();
    mockVariantsBatch.mockReturnValue({
      data: undefined,
      isError: true,
      refetch,
    });
    const { user } = await fillRecipientAndOpenSearch();

    const dialog = await screen.findByRole('dialog');
    await user.click(
      within(dialog).getByRole('button', { name: '옵션 3개 모두 보기' })
    );
    expect(
      within(dialog).getByText(/옵션 이름을 불러오지 못했습니다/)
    ).toBeTruthy();
    expect(
      within(dialog).queryByRole('button', { name: /이름 없음/ })
    ).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: '다시 시도' }));
    expect(refetch).toHaveBeenCalled();
  });

  it('옵션 이름을 못 받은 페이지에서도 다른 페이지로 넘어갈 수 있다', async () => {
    mockMasters.mockReturnValue(
      ok({ data: [master({ variantCount: 150 })], total: 1 })
    );
    mockVariantRows.mockReturnValue(
      ok({
        data: [
          { id: 'variant-x', variantName: null, price: 0, status: 'active' },
        ],
        total: 150,
        page: 1,
        limit: 100,
      })
    );
    mockVariantsBatch.mockReturnValue({
      data: undefined,
      isError: true,
      refetch: jest.fn(),
    });
    const { user } = await fillRecipientAndOpenSearch();

    const dialog = await screen.findByRole('dialog');
    await user.click(
      within(dialog).getByRole('button', { name: '옵션 150개 모두 보기' })
    );
    expect(
      within(dialog).getByText(/옵션 이름을 불러오지 못했습니다/)
    ).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: '다음 옵션' }));
    expect(mockVariantRows).toHaveBeenLastCalledWith('master-a', {
      page: 2,
      limit: 100,
    });
  });

  it('옵션 수는 펼친 응답의 total 을 따르고, 줄어들면 범위 안 페이지로 돌아간다', async () => {
    // 요약은 101개라 했지만 펼친 응답은 150개다.
    mockMasters.mockReturnValue(
      ok({ data: [master({ variantCount: 101 })], total: 1 })
    );
    let shrunk = false;
    mockVariantRows.mockImplementation((_id, opts) => {
      const { page } = opts as { page: number };
      const total = shrunk ? 90 : 150;
      const count = total > (page - 1) * 100 ? 2 : 0;
      return ok({
        data: Array.from({ length: count }, (_, i) => ({
          id: `variant-${page}-${i}`,
          variantName: `옵션 ${page}-${i}`,
          price: 500,
          status: 'active',
        })),
        total,
        page,
        limit: 100,
      });
    });
    const { user } = await fillRecipientAndOpenSearch();

    const dialog = await screen.findByRole('dialog');
    await user.click(
      within(dialog).getByRole('button', { name: '옵션 101개 모두 보기' })
    );
    expect(within(dialog).getByText('1–100 / 150')).toBeTruthy();

    shrunk = true;
    await user.click(within(dialog).getByRole('button', { name: '다음 옵션' }));

    await waitFor(() =>
      expect(mockVariantRows).toHaveBeenLastCalledWith('master-a', {
        page: 1,
        limit: 100,
      })
    );
    expect(within(dialog).queryByText(/\/ 150/)).toBeNull();
  });

  it('다음 페이지를 받는 동안 페이지를 처음으로 되돌리지 않는다', async () => {
    mockMasters.mockReturnValue(
      ok({ data: [master({ variantCount: 90 })], total: 1 })
    );
    mockVariantRows.mockImplementation((_id, opts) => {
      const { page } = opts as { page: number };
      if (page === 2) {
        return {
          data: undefined,
          isPending: true,
          isError: false,
          refetch: jest.fn(),
        };
      }
      return ok({
        data: Array.from({ length: 2 }, (_, i) => ({
          id: `variant-${i}`,
          variantName: `옵션 ${i}`,
          price: 500,
          status: 'active',
        })),
        total: 150,
        page,
        limit: 100,
      });
    });
    const { user } = await fillRecipientAndOpenSearch();

    const dialog = await screen.findByRole('dialog');
    await user.click(
      within(dialog).getByRole('button', { name: '옵션 90개 모두 보기' })
    );
    await user.click(within(dialog).getByRole('button', { name: '다음 옵션' }));

    expect(within(dialog).getByText('옵션 불러오는 중...')).toBeTruthy();
    expect(within(dialog).getByText('101–150 / 150')).toBeTruthy();
    expect(mockVariantRows).toHaveBeenLastCalledWith('master-a', {
      page: 2,
      limit: 100,
    });
  });

  it('상품 목록을 못 불러와도 입력값을 지우지 않고 다시 시도할 수 있다', async () => {
    const refetch = jest.fn();
    mockMasters.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      refetch,
    });
    const { user, recipient } = await fillRecipientAndOpenSearch();

    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(/상품 목록을 불러오지 못했습니다/)
    ).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: '다시 시도' }));
    expect(refetch).toHaveBeenCalled();
    expect((recipient as HTMLInputElement).value).toBe('받는분');
  });

  it('주문 줄은 판매상품 옵션으로만 담는다', async () => {
    mockMasters.mockReturnValue(ok({ data: [master({})], total: 1 }));
    await fillRecipientAndOpenSearch();

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('tab')).toBeNull();
  });
});

const VARIANT = '44444444-4444-4444-8444-444444444444';

function fieldInput(label: string, index = 0) {
  const field = screen.getAllByText(label)[index].parentElement;
  return within(field as HTMLElement).getByRole('textbox');
}

async function fillOrder() {
  mockMasters.mockReturnValue(
    ok({
      data: [master({ variantPreviews: [preview(VARIANT, '빨강', 1000)] })],
      total: 1,
    })
  );
  const { user } = await fillRecipientAndOpenSearch();
  const dialog = await screen.findByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: /빨강/ }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  for (const [label, value, index] of [
    ['핸드폰', '010', 1],
    ['우편번호', '00000', 0],
    ['주소', '도로명', 0],
    ['상세주소', '1호', 0],
  ] as const) {
    await user.click(fieldInput(label, index));
    await user.paste(value);
  }
  return user;
}

describe('수동 주문 저장', () => {
  it('Core 주문 계약으로 저장하고 주문내역으로 간다', async () => {
    const user = await fillOrder();
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(mockMutate).toHaveBeenCalledTimes(1);
    const [payload, options] = mockMutate.mock.calls[0];
    expect(payload).toMatchObject({
      channelOrderId: expect.stringMatching(/^SO-\d{8}-[A-Z0-9]{6}$/),
      salesChannel: '3pl',
      shippingAddress: {
        recipientName: '받는분',
        phone: '010',
        postalCode: '00000',
        roadAddress: '도로명',
        detailAddress: '1호',
      },
      lines: [{ variantId: VARIANT, quantity: 1, unitPrice: 1000 }],
      totalAmount: 1000,
    });
    options.onSuccess();
    expect(mockPush).toHaveBeenCalledWith('/order/history');
  });

  it('빠진 칸을 알려 주고 저장 요청을 보내지 않는다', async () => {
    mockMasters.mockReturnValue(ok({ data: [], total: 0 }));
    const user = userEvent.setup();
    render(<ManualSingleOrderPage />);
    const recipient = fieldInput('수취인 성명');
    await user.type(recipient, '받는분');
    await user.click(screen.getByRole('button', { name: '저장' }));

    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('받는 분 연락처를 입력해 주세요.')).toBeTruthy();
    expect(within(alert).getByText('주문상품을 1개 이상 담아 주세요.')).toBeTruthy();
    expect(mockMutate).not.toHaveBeenCalled();
    expect((recipient as HTMLInputElement).value).toBe('받는분');
  });

  it('같은 주문번호가 이미 있으면 서버 안내를 보여 주고 입력을 남긴다', async () => {
    const user = await fillOrder();
    await user.click(screen.getByRole('button', { name: '저장' }));
    const [, options] = mockMutate.mock.calls[0];
    const message = '주문번호 SO-1 로 저장된 주문이 이미 있습니다.';

    act(() => options.onError(new CustomError({ message, statusCode: 409 })));

    expect(within(screen.getByRole('alert')).getByText(message)).toBeTruthy();
    expect(mockPush).not.toHaveBeenCalled();
    expect((fieldInput('상세주소') as HTMLInputElement).value).toBe('1호');
  });
});
