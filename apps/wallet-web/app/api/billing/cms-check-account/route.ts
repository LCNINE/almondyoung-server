import { checkCmsAccount } from '@/lib/wallet-api';
import { getBackendAuthCookie } from '@/lib/auth/session-cookies';

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, string> | null;
  if (!body) {
    return Response.json({ error: '잘못된 요청입니다.' }, { status: 400 });
  }

  const { paymentCompany, paymentNumber, payerNumber } = body;
  if (!paymentCompany || !paymentNumber || !payerNumber) {
    return Response.json({ error: '필수 항목이 누락되었습니다.' }, { status: 400 });
  }

  const cookieHeader = await getBackendAuthCookie();

  try {
    const result = await checkCmsAccount({ paymentCompany, paymentNumber, payerNumber }, cookieHeader);
    return Response.json(result, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : '계좌 확인 중 오류가 발생했습니다.';
    return Response.json({ error: message }, { status: message.includes('(4') ? 400 : 502 });
  }
}
