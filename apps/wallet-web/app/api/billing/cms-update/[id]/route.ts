import { updateCmsBankAccount } from '@/lib/wallet-api';

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const body = await request.json().catch(() => null);
  if (!body) {
    return Response.json({ error: '잘못된 요청입니다.' }, { status: 400 });
  }

  const { paymentCompany, payerName, payerNumber, paymentNumber, phone } = body as Record<string, string>;
  if (!paymentCompany || !payerName || !payerNumber || !paymentNumber || !phone) {
    return Response.json({ error: '필수 항목이 누락되었습니다.' }, { status: 400 });
  }

  const cookieHeader = request.headers.get('Cookie') ?? '';

  try {
    await updateCmsBankAccount(id, { paymentCompany, payerName, payerNumber, paymentNumber, phone }, cookieHeader);
    return new Response(null, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : '계좌 변경 중 오류가 발생했습니다.';
    const status = message.includes('(4') ? 400 : 502;
    return Response.json({ error: message }, { status });
  }
}
