import { createCipheriv } from 'crypto';
import { issueNicepayBillingKey } from '@/lib/wallet-api';

/**
 * NicePay 빌링키 발급 서버 라우트
 *
 * 클라이언트에서 카드 정보를 받아 서버에서 AES-128/ECB로 암호화(encData)한 뒤
 * wallet 백엔드 POST /v1/billing-methods/nicepay 를 호출
 *
 * SecretKey는 서버에서만 사용하므로 클라이언트에 노출되지 않음
 *
 * Body (JSON):
 *   cardNo    - 카드번호 16자리 (숫자만)
 *   expYear   - 유효기간 년 (YY)
 *   expMonth  - 유효기간 월 (MM)
 *   idNo      - 생년월일 6자리 (개인) / 사업자번호 10자리 (법인)
 *   cardPw    - 카드 비밀번호 앞 2자리
 *   orderId   - 상점 고유 주문번호 (64자 이하)
 *   encMode   - (선택) 'A2' = AES-256/CBC, 생략 시 AES-128/ECB
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body) {
    return Response.json({ error: '잘못된 요청입니다.' }, { status: 400 });
  }

  const { cardNo, expYear, expMonth, idNo, cardPw, orderId, encMode } = body as Record<string, string>;

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
      // AES-256 CBC, IV = SecretKey 앞 16자리
      const key = Buffer.from(secretKey.slice(0, 32), 'utf8');
      const iv = Buffer.from(secretKey.slice(0, 16), 'utf8');
      const cipher = createCipheriv('aes-256-cbc', key, iv);
      encData = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]).toString('hex');
    } else {
      // AES-128 ECB (기본), key = SecretKey 앞 16자리
      const key = Buffer.from(secretKey.slice(0, 16), 'utf8');
      const cipher = createCipheriv('aes-128-ecb', key, Buffer.alloc(0));
      encData = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]).toString('hex');
    }
  } catch {
    return Response.json({ error: '카드 정보 암호화 중 오류가 발생했습니다.' }, { status: 500 });
  }

  const cookieHeader = request.headers.get('Cookie') ?? '';

  try {
    await issueNicepayBillingKey(encData, orderId, cookieHeader, encMode);
    return Response.json({});
  } catch (err) {
    const message = err instanceof Error ? err.message : '카드 등록 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
    const status = message.includes('failed (4') ? 400 : 502;
    return Response.json({ error: message }, { status });
  }
}
