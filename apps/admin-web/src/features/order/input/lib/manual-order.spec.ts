import { CustomError } from '@/lib/api/customError';
import {
  BULK_ORDER_COLUMNS,
  CSV_BOM,
  groupBulkOrders,
  parseCsv,
  readBulkOrderCsv,
  toCsv,
  variantIdsOf,
} from './bulk-order-csv';
import {
  buildManualOrder,
  describeSaveError,
  generateManualOrderNo,
  type ManualOrderInput,
} from './manual-order';

const V1 = '11111111-1111-4111-8111-111111111111';
const V2 = '22222222-2222-4222-8222-222222222222';
const CUSTOMER = '33333333-3333-4333-8333-333333333333';

const input = (
  overrides: Partial<ManualOrderInput> = {}
): ManualOrderInput => ({
  orderNo: ' SO-1 ',
  recipient: {
    name: '받는 분',
    phone: '010-0000-0000',
    postalCode: '00000',
    roadAddress: '도로명 1',
    detailAddress: '101호',
  },
  lines: [{ variantId: V1, label: '상품 A', quantity: 2, unitPrice: 1500 }],
  ...overrides,
});

describe('buildManualOrder', () => {
  it('builds the core create contract with the order number as the channel order id', () => {
    const result = buildManualOrder(
      input({
        customerId: CUSTOMER,
        buyer: { name: '주문자', phone: '' },
        memo: ' 전화 접수 ',
      })
    );

    expect(result.issues).toEqual([]);
    expect(result.payload).toEqual({
      channelOrderId: 'SO-1',
      salesChannel: '3pl',
      customer: { id: CUSTOMER, name: '주문자' },
      shippingAddress: {
        recipientName: '받는 분',
        phone: '010-0000-0000',
        postalCode: '00000',
        roadAddress: '도로명 1',
        detailAddress: '101호',
      },
      lines: [
        {
          variantId: V1,
          productName: '상품 A',
          quantity: 2,
          unitPrice: 1500,
          totalPrice: 3000,
        },
      ],
      totalAmount: 3000,
      shippingFee: 0,
      memo: '전화 접수',
    });
  });

  it('asks for whole won amounts', () => {
    const result = buildManualOrder(
      input({
        lines: [{ variantId: V1, label: 'A', quantity: 1, unitPrice: 1.5 }],
      })
    );
    expect(result.issues.map((i) => i.message)).toEqual([
      'A: 단가는 원 단위 정수로 적어 주세요.',
    ]);
  });

  it('keeps a zero price as a real price', () => {
    const result = buildManualOrder(
      input({
        lines: [{ variantId: V1, label: 'A', quantity: 1, unitPrice: 0 }],
      })
    );
    expect(result.payload?.lines[0]).toMatchObject({
      unitPrice: 0,
      totalPrice: 0,
    });
  });

  it('names every missing field the server would reject', () => {
    const result = buildManualOrder({
      orderNo: '',
      customerId: 'not-a-uuid',
      buyer: { email: 'wrong' },
      recipient: {
        name: '',
        phone: '',
        postalCode: '',
        roadAddress: '',
        detailAddress: '',
      },
      lines: [],
    });

    expect(result.payload).toBeNull();
    expect(result.issues.map((i) => i.field)).toEqual([
      'orderNo',
      'customerId',
      'buyerEmail',
      'recipientName',
      'recipientPhone',
      'postalCode',
      'roadAddress',
      'detailAddress',
      'lines',
    ]);
  });

  it('refuses lines without a sales option, a whole quantity, or a unit price', () => {
    const result = buildManualOrder(
      input({
        lines: [
          { label: '재고상품', quantity: 1, unitPrice: 100 },
          { variantId: V2, label: '상품 B', quantity: 1.5, unitPrice: null },
        ],
      })
    );

    expect(result.issues.map((i) => i.message)).toEqual([
      '재고상품: 판매상품 옵션으로 담아 주세요.',
      '상품 B: 수량은 1 이상의 정수로 적어 주세요.',
      '상품 B: 단가를 입력해 주세요. 무상이면 0을 적어 주세요.',
    ]);
  });
});

describe('generateManualOrderNo', () => {
  it('uses the date and a random suffix', () => {
    expect(generateManualOrderNo(new Date(2026, 0, 2), () => 0)).toBe(
      'SO-20260102-AAAAAA'
    );
  });
});

describe('describeSaveError', () => {
  it('shows the server sentence for an order number that is already saved', () => {
    const error = new CustomError({
      message: '주문번호 SO-1 로 저장된 주문이 이미 있습니다.',
      statusCode: 409,
    });
    expect(describeSaveError(error)).toEqual({
      kind: 'duplicate',
      message: error.message,
    });
  });

  it('treats a lost response as safe to retry with the same number', () => {
    expect(
      describeSaveError(
        new CustomError({ message: 'Network Error', statusCode: 500 })
      ).kind
    ).toBe('retry');
  });

  it('reports a rejected request as an input problem', () => {
    expect(
      describeSaveError(
        new CustomError({
          message: 'lines should not be empty',
          statusCode: 400,
        })
      )
    ).toEqual({
      kind: 'invalid',
      message:
        '저장하지 못했습니다. 입력값을 확인해 주세요. (lines should not be empty)',
    });
  });
});

describe('bulk order csv', () => {
  const header = BULK_ORDER_COLUMNS.join(',');
  const row = (
    values: Partial<Record<(typeof BULK_ORDER_COLUMNS)[number], string>>
  ) =>
    toCsv([
      BULK_ORDER_COLUMNS.map(
        (c) =>
          values[c] ??
          (
            {
              orderNo: 'SO-1',
              recipientName: '받는 분',
              recipientPhone: '010-0000-0000',
              zip: '00000',
              addr1: '도로명 1, 2층',
              addr2: '101호',
              variantId: V1,
              quantity: '1',
              unitPrice: '1,000',
            } as Record<string, string>
          )[c] ??
          ''
      ),
    ]);
  const variants = new Map([
    [V1, { label: '상품 A' }],
    [V2, { label: '상품 B' }],
  ]);

  it('parses quoted commas, escaped quotes, CRLF and the excel BOM', () => {
    expect(parseCsv(CSV_BOM + 'a,b\r\n"x, y","say ""hi"""\r\n')).toEqual({
      rows: [
        ['a', 'b'],
        ['x, y', 'say "hi"'],
      ],
      unclosedQuoteRow: null,
    });
  });

  it('refuses a file whose quote never closes instead of swallowing the next orders', () => {
    // 엑셀이 아니라 손으로 고친 파일에서 생긴다 — 메모 칸을 따옴표로 열고 닫지 않았다
    const broken = row({ memo: 'MEMO' }).replace('MEMO', '"메모');
    const csv = [header, broken, row({ orderNo: 'SO-2' })].join('\n');
    expect(readBulkOrderCsv(csv).fileIssues).toEqual([
      '2행에서 시작한 따옴표(")가 닫히지 않았습니다. 그 행의 칸을 확인해 주세요.',
    ]);
  });

  it('rejects a unit price with decimals', () => {
    const [order] = groupBulkOrders(
      readBulkOrderCsv([header, row({ unitPrice: '1.5' })].join('\n')).rows,
      variants
    );
    expect(order.issues).toEqual([
      '[2행] unitPrice 는 원 단위 정수로 적어 주세요. 무상이면 0.',
    ]);
  });

  it('groups rows by order number and builds one request per order', () => {
    const csv = [
      header,
      row({}),
      row({ variantId: V2, quantity: '3', unitPrice: '200' }),
    ].join('\r\n');
    const read = readBulkOrderCsv(csv);
    expect(read.fileIssues).toEqual([]);

    const [order] = groupBulkOrders(read.rows, variants);
    expect(order.issues).toEqual([]);
    expect(order.lineNos).toEqual([2, 3]);
    expect(order.payload).toMatchObject({
      channelOrderId: 'SO-1',
      shippingAddress: { roadAddress: '도로명 1, 2층' },
      lines: [
        { variantId: V1, productName: '상품 A', quantity: 1, unitPrice: 1000 },
        { variantId: V2, productName: '상품 B', quantity: 3, unitPrice: 200 },
      ],
      totalAmount: 1600,
    });
  });

  it('points at the row and column of each problem', () => {
    const csv = [
      header,
      row({ variantId: 'SKU-1', quantity: '0' }),
      row({ recipientName: '다른 사람', unitPrice: '' }),
      row({ orderNo: '' }),
      row({ orderNo: 'SO-2', variantId: V2, addr2: '' }),
    ].join('\n');
    const orders = groupBulkOrders(
      readBulkOrderCsv(csv).rows,
      new Map([[V1, { label: '상품 A' }]])
    );

    expect(orders.map((o) => o.issues)).toEqual([
      ['[4행] orderNo 를 입력해 주세요.'],
      [
        '[3행] 같은 주문번호의 2행과 주문 정보가 다릅니다 (recipientName). 한 주문의 행은 상품 칸만 달라야 합니다.',
        '[2행] variantId 가 옵션 ID 형식이 아닙니다.',
        '[2행] quantity 는 1 이상의 정수로 적어 주세요.',
        '[3행] unitPrice 는 원 단위 정수로 적어 주세요. 무상이면 0.',
      ],
      [
        `[5행] 판매 중인 상품 옵션을 찾을 수 없습니다 (${V2}).`,
        "[5행] 상세 주소를 입력해 주세요. 없으면 '없음'이라고 적어 주세요.",
      ],
    ]);
    expect(orders.every((o) => o.payload === null)).toBe(true);
  });

  it('keeps excel row numbers when the file has blank rows', () => {
    const csv = [header, row({}), ',,,', '', row({ quantity: 'x' })].join('\n');
    const [order] = groupBulkOrders(readBulkOrderCsv(csv).rows, variants);
    expect(order.lineNos).toEqual([2, 5]);
    expect(order.issues).toEqual([
      '[5행] quantity 는 1 이상의 정수로 적어 주세요.',
    ]);
  });

  it('blocks orders until the options are looked up', () => {
    const [order] = groupBulkOrders(
      readBulkOrderCsv([header, row({})].join('\n')).rows,
      null
    );
    expect(order.payload).toBeNull();
    expect(order.issues).toEqual([
      '[2행] 상품 정보를 아직 확인하지 못했습니다. 잠시 뒤 다시 확인해 주세요.',
    ]);
  });

  it('asks for the new template when an old one is uploaded', () => {
    const old =
      'orderNo,customerId,warehouseId,skuId,quantity,unitPrice\nSO-1,,WH-1,SKU-1,1,100';
    expect(readBulkOrderCsv(old).fileIssues).toEqual([
      '이전 양식입니다. 「양식 내려받기」로 새 양식을 받아 다시 작성해 주세요.',
    ]);
  });

  it('only looks up ids that are option ids', () => {
    const csv = [header, row({}), row({ variantId: 'SKU-1' }), row({})].join(
      '\n'
    );
    expect(variantIdsOf(readBulkOrderCsv(csv).rows)).toEqual([V1]);
  });
});
