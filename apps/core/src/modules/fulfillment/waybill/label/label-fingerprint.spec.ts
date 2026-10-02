import { HANJIN_LABEL_FIXTURE } from '../carrier/hanjin/label/__support__/hanjin-label-fixture';
import type { HanjinLabelContent } from '../carrier/hanjin/label/hanjin-label-data';
import { labelFingerprint } from './label-fingerprint';

// 픽스처는 출력 시점 값까지 가진 HanjinLabelData 다 — 내용만 떼어 낸다.
const { printedDate: _printedDate, revision: _revision, ...CONTENT } = HANJIN_LABEL_FIXTURE;
const content: HanjinLabelContent = CONTENT;

describe('labelFingerprint', () => {
  it('같은 내용이면 같은 64자 hex', () => {
    expect(labelFingerprint(content)).toMatch(/^[0-9a-f]{64}$/);
    expect(labelFingerprint({ ...content })).toBe(labelFingerprint(content));
  });

  it.each([
    ['품목 줄 수량', { items: [{ ...content.items[0], quantity: 9 }, ...content.items.slice(1)] }],
    ['품목 줄 로케이션', { items: [{ ...content.items[0], locationCode: 'Z-99' }, ...content.items.slice(1)] }],
    ['수령인', { recipient: { ...content.recipient, detailAddress: '다른 호수' } }],
    ['배송 메시지(공동현관 비밀번호)', { deliveryMessage: '문앞 (공동현관 #9999)' }],
    ['송장 번호', { trackingNo: '999999999999' }],
  ])('%s 가 바뀌면 달라진다', (_label, patch) => {
    expect(labelFingerprint({ ...content, ...patch })).not.toBe(labelFingerprint(content));
  });
});
