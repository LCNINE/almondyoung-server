import { createCipheriv } from 'crypto';
import { issueNicepayBillingKey, updateBillingAgreementMethod } from '@/lib/wallet-api';

/**
 * 마이페이지 정기결제 카드 변경 라우트
 *
 * nicepay-regist와 동일하게 카드 정보를 AES 암호화하여 빌링키를 발급하고,
 * agreementId가 있으면 해당 billing_agreement의 결제 수단을 새 카드로 업데이트한다.
 *
 * Body (JSON):
 *   cardNo     - 카드번호 16자리 (숫자만)
 *   expYear    - 유효기간 년 (YY)
 *   expMonth   - 유효기간 월 (MM)
 *   idNo       - 생년월일 6자리 (개인) / 사업자번호 10자리 (법인)
 *   cardPw     - 카드 비밀번호 앞 2자리
 *   orderId    - 상점 고유 주문번호 (64자 이하)
 *   agreementId - (선택) 업데이트할 billing_agreement ID
 *   encMode    - (선택) 'A2' = AES-256/CBC, 생략 시 AES-128/ECB
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body) {
    return Response.json({ error: '잘못된 요청입니다.' }, { status: 400 });
  }

  const { cardNo, expYear, expMonth, idNo, cardPw, orderId, agreementId, encMode } = body as Record<string, string>;

  if (!cardNo || !expYear || !expMonth || !idNo || !cardPw || !orderId) {
    return Response.json({ error: '필수 항목이 누락되었습니다.' }, { status: 400 });
  }

  const secretKey = process.env.NICEPAY_SECRET_KEY ?? '';
  if (!secretKey) {
    return Response.json({ error: '결제 설정 오류가 발생했습니다.' }, { status: 500 });
  }

  const plaintext = `cardNo=${cardNo}&expYear=${expYear}&expMonth=${expMonth}&idNo=${idNo}&cardPw=${cardPw}`;

  let encData: string;
  try {
    if (encMode === 'A2') {
      const key = Buffer.from(secretKey.slice(0, 32), 'utf8');
      const iv = Buffer.from(secretKey.slice(0, 16), 'utf8');
      const cipher = createCipheriv('aes-256-cbc', key, iv);
      encData = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]).toString('hex');
    } else {
      const key = Buffer.from(secretKey.slice(0, 16), 'utf8');
      const cipher = createCipheriv('aes-128-ecb', key, Buffer.alloc(0));
      encData = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]).toString('hex');
    }
  } catch {
    return Response.json({ error: '카드 정보 암호화 중 오류가 발생했습니다.' }, { status: 500 });
  }

  const cookieHeader = request.headers.get('Cookie') ?? '';

  try {
    const { id: billingMethodId } = await issueNicepayBillingKey(encData, orderId, cookieHeader, encMode);

    if (agreementId && billingMethodId) {
      await updateBillingAgreementMethod(agreementId, billingMethodId, cookieHeader);
    }

    return Response.json({});
  } catch (err) {
    const message = err instanceof Error ? err.message : '카드 변경 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
    const status = message.includes('failed (4') ? 400 : 502;
    return Response.json({ error: message }, { status });
  }
}
