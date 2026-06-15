const WALLET_API_URL = process.env.NEXT_PUBLIC_WALLET_API_URL ?? 'http://localhost:3100';

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: '잘못된 요청입니다.' }, { status: 400 });
  }

  const required = ['paymentCompany', 'payerName', 'payerNumber', 'paymentNumber', 'phone'];
  for (const field of required) {
    if (!formData.get(field)) {
      return Response.json({ error: `필수 항목이 누락되었습니다: ${field}` }, { status: 400 });
    }
  }
  if (!formData.get('file')) {
    return Response.json({ error: '전자서명 파일이 필요합니다.' }, { status: 400 });
  }

  const cookieHeader = request.headers.get('Cookie') ?? '';

  try {
    const res = await fetch(`${WALLET_API_URL}/v1/billing-methods/cms/register-with-agreement`, {
      method: 'POST',
      headers: { Cookie: cookieHeader, 'Idempotency-Key': crypto.randomUUID() },
      body: formData,
      cache: 'no-store',
    });

    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const errMsg = (body?.message as string) ?? `등록 실패 (${res.status})`;
      return Response.json({ error: errMsg }, { status: res.status >= 500 ? 502 : 400 });
    }

    return Response.json(body, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : '서버 오류';
    return Response.json({ error: message }, { status: 502 });
  }
}
