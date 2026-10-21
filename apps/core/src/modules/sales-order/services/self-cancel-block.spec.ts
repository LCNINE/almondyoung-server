import { selfCancelBlock, SelfCancelBlock, SelfCancelFacts } from './self-cancel-block';

const open: SelfCancelFacts = {
  orderStatus: 'confirmed',
  salesChannel: 'medusa',
  anyShipped: false,
  pickingStarted: false,
  hasRecoveryBox: false,
};

const blocked: SelfCancelFacts = {
  orderStatus: 'cancelled',
  salesChannel: 'naver',
  anyShipped: true,
  pickingStarted: true,
  hasRecoveryBox: true,
};

const notDownloaded = () => Promise.resolve(false);
const downloaded = () => Promise.resolve(true);

describe('selfCancelBlock', () => {
  it('아무 사실도 걸리지 않으면 막지 않는다', async () => {
    expect(await selfCancelBlock(open, notDownloaded)).toBeNull();
  });

  // 스펙 §4.4 표: 모든 사실을 켠 뒤 위에서부터 하나씩 끄면 사유가 표의 순서대로 내려온다.
  // 4·5번은 사유가 같아 문구로 가린다 — 둘의 순서가 바뀌면 문구가 엇갈린다.
  it('사실을 위에서부터 하나씩 끄면 표의 순서대로 사유가 나온다', async () => {
    const blocks: Array<SelfCancelBlock | null> = [];
    const facts = { ...blocked };
    blocks.push(await selfCancelBlock(facts, downloaded));
    facts.orderStatus = 'confirmed';
    blocks.push(await selfCancelBlock(facts, downloaded));
    facts.anyShipped = false;
    blocks.push(await selfCancelBlock(facts, downloaded));
    facts.salesChannel = 'medusa';
    blocks.push(await selfCancelBlock(facts, downloaded));
    facts.pickingStarted = false;
    blocks.push(await selfCancelBlock(facts, downloaded));
    facts.hasRecoveryBox = false;
    blocks.push(await selfCancelBlock(facts, downloaded));
    blocks.push(await selfCancelBlock(facts, notDownloaded));

    expect(blocks.map((block) => block?.reason ?? null)).toEqual([
      'already_cancelled',
      'already_shipped',
      'channel_order',
      'already_processing',
      'already_processing',
      'digital_downloaded',
      null,
    ]);
    expect(blocks[3]?.message).toBe('피킹이 시작된 주문은 직접 취소할 수 없습니다. 고객센터로 문의해 주세요.');
    expect(blocks[4]?.message).toBe('처리 중인 주문이라 직접 취소할 수 없습니다. 고객센터로 문의해 주세요.');
  });

  it.each<[string, Partial<SelfCancelFacts>, string]>([
    ['취소된 주문', { orderStatus: 'cancelled' }, 'already_cancelled'],
    ['출고 증거', { anyShipped: true }, 'already_shipped'],
    ['채널 주문', { salesChannel: 'naver' }, 'channel_order'],
    ['피킹 시작', { pickingStarted: true }, 'already_processing'],
    ['복구 중 상자', { hasRecoveryBox: true }, 'already_processing'],
  ])('%s 하나만 켜면 그 사유다', async (_name, patch, reason) => {
    expect((await selfCancelBlock({ ...open, ...patch }, notDownloaded))?.reason).toBe(reason);
  });

  it('복구 중 상자는 피킹 시작과 같은 사유지만 문구가 따로다', async () => {
    expect((await selfCancelBlock({ ...open, hasRecoveryBox: true }, notDownloaded))?.message).toBe(
      '처리 중인 주문이라 직접 취소할 수 없습니다. 고객센터로 문의해 주세요.',
    );
    expect((await selfCancelBlock({ ...open, pickingStarted: true }, notDownloaded))?.message).toBe(
      '피킹이 시작된 주문은 직접 취소할 수 없습니다. 고객센터로 문의해 주세요.',
    );
  });

  it('다운로드 여부는 앞 사실이 다 통과했을 때만 묻는다', async () => {
    const digital = jest.fn(downloaded);
    await selfCancelBlock({ ...open, hasRecoveryBox: true }, digital);
    expect(digital).not.toHaveBeenCalled();
    await selfCancelBlock(open, digital);
    expect(digital).toHaveBeenCalledTimes(1);
  });
});
