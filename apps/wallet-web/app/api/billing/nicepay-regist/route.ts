import { issueNicepayBillingKey } from '@/lib/wallet-api';
import { encryptNicepayCardData } from '@/lib/nicepay-encrypt';

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

  let encData: string;
  try {
    encData = encryptNicepayCardData(cardNo, expYear, expMonth, idNo, cardPw, secretKey, encMode);
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
