import { csCases } from '../schema/customer-service.schema';
import { makeFakeDb } from '../__fixtures__/fake-db';
import { CsCasesService } from './cs-cases.service';

describe('CsCasesService.create', () => {
  it('creates a ticket with defaults and stamps the operator', async () => {
    const { db, state } = makeFakeDb();
    const service = new CsCasesService(db as any);

    const created = await service.create(
      { subject: '상품 불량 문의', description: '카톡 내용 요약', externalThreadRef: '카톡상담방 A' },
      'operator-1',
    );

    expect(state.get(csCases)).toHaveLength(1);
    expect(created).toMatchObject({
      subject: '상품 불량 문의',
      status: 'open',
      priority: 'normal',
      sourceChannel: 'kakao',
      externalThreadRef: '카톡상담방 A',
      createdBy: 'operator-1',
      labelIds: [],
      timeline: [],
    });
  });
});
