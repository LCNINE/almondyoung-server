import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getBillingMethods, getMyBusinessLicense } from '@/lib/wallet-api';
import { isAccessTokenUsable, selfOrigin, verifiedAccessTokenIdentity } from '@/lib/auth/access-token';
import { isEntryValidFor, readEntryTicket } from '@/lib/auth/entry-ticket';
import { SESSION_COOKIE_NAMES, getBackendAuthCookie } from '@/lib/auth/session-cookies';
import { STOREFRONT_ORIGIN, isSubscribeReturnUrl, safeReturnUrl } from '@/lib/return-url';
import { BillingChangeForm } from './billing-change-form';
import { PendingSignupResume } from './pending-signup-resume';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{
    returnUrl?: string;
    fail?: string;
    msg?: string;
    /** '1' 이면 심사 중 계좌가 있어도 새 계좌 등록 폼을 연다(고객이 직접 고른 경우). */
    register?: string;
    /** 콜백이 붙인 1회용 진입표. */
    entry?: string;
  }>;
}

export default async function BillingChangePage({ searchParams }: Props) {
  const params = await searchParams;
  const { returnUrl, fail, msg, register, entry } = params;

  // 결제수단은 세션 계정에 바로 붙으므로, 쇼핑몰이 지금 고객을 보증한 직후(진입표)에만 화면을 연다.
  // 남아 있는 세션(쇼핑몰에서 계정을 바꾼 브라우저라면 이전 계정)을 refresh 로 되살리지 않는다.
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(SESSION_COOKIE_NAMES.ACCESS_TOKEN)?.value;
  const identity = (await isAccessTokenUsable(accessToken)) ? await verifiedAccessTokenIdentity(accessToken) : null;
  const ticket = await readEntryTicket();

  if (!identity || !isEntryValidFor(ticket, identity.sub, entry ?? null)) {
    // 방금 진입표를 받고 왔는데도 맞지 않으면(쿠키 차단 등) 다시 보내 봐야 같은 자리로 돌아온다.
    if (entry) return <EntryFailed returnUrl={safeReturnUrl(returnUrl, STOREFRONT_ORIGIN)} />;

    const selfPath = billingChangePath(params);
    const handoffPath = `/auth/handoff?redirect_to=${encodeURIComponent(selfPath)}`;
    const origin = selfOrigin();
    redirect(origin ? `${origin}${handoffPath}` : handoffPath);
  }

  const safeReturn = safeReturnUrl(returnUrl, STOREFRONT_ORIGIN);
  const subscribeFlow = isSubscribeReturnUrl(safeReturn);

  // 가입 도중엔 심사 중 계좌도 본다 — 기본 조회는 승인된 계좌만 줘서, 계좌만 등록하고 떠났던 고객이
  // 다시 오면 같은 사람이 은행 심사를 한 번 더 걸게 됐다. 계좌 변경 화면은 조회를 바꾸지 않는다.
  const [methods, profile] = await Promise.all([
    getBillingMethods(await getBackendAuthCookie(), { includePendingMandate: subscribeFlow }),
    getMyBusinessLicense(accessToken),
  ]);
  const activeCms = methods.filter((m) => m.providerType === 'CMS_BATCH' && m.status === 'ACTIVE');
  const cmsBillingMethod = activeCms.find((m) => m.cmsMemberStatus !== 'PENDING');
  // 심사 중 계좌가 여럿이면 가장 최근에 등록한 것으로 잇는다.
  const pendingCmsMethod = activeCms
    .filter((m) => m.cmsMemberStatus === 'PENDING')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  if (subscribeFlow && !cmsBillingMethod && pendingCmsMethod && register !== '1') {
    return (
      <PendingSignupResume
        returnUrl={safeReturn}
        billingMethodId={pendingCmsMethod.id}
        displayName={pendingCmsMethod.displayName}
      />
    );
  }

  const initialError =
    fail === '1' ? decodeURIComponent(msg ?? '계좌 변경에 실패했습니다. 다시 시도해주세요.') : undefined;

  return (
    <BillingChangeForm
      returnUrl={safeReturn}
      billingMethodId={cmsBillingMethod?.id}
      initialPhone={profile?.phoneNumber ?? ''}
      initialError={initialError}
      entryId={ticket?.id ?? ''}
      account={{
        name: identity.name,
        loginId: identity.loginId,
        reselectHref: storefrontAccountSwitchHref(safeReturn),
      }}
    />
  );
}

function billingChangePath(params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key !== 'entry' && value !== undefined) query.set(key, value);
  }
  const qs = query.toString();

  return qs ? `/billing-change?${qs}` : '/billing-change';
}

// 계정은 쇼핑몰에서 바꾼다. wallet-web 에서만 바꾸면 다음 진입 때 쇼핑몰 계정으로 다시 맞춰져 고객이 헷갈린다.
function storefrontAccountSwitchHref(returnUrl: string): string {
  const base = parseAbsoluteUrl(returnUrl) ?? parseAbsoluteUrl(process.env.STOREFRONT_ORIGIN);
  if (!base) return '/login?prompt=select_account';

  const country = base.pathname.split('/')[1] ?? '';
  const login = new URL(`/${/^[a-z]{2}$/.test(country) ? country : 'kr'}/login`, base.origin);
  login.searchParams.set('prompt', 'select_account');
  login.searchParams.set('redirect_to', `${base.pathname}${base.search}`);

  return login.toString();
}

function parseAbsoluteUrl(value: string | undefined): URL | null {
  if (!value) return null;

  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function EntryFailed({ returnUrl }: { returnUrl: string }) {
  return (
    <div className="mx-auto flex h-dvh w-full max-w-md flex-col justify-center gap-6 bg-background px-5">
      <div className="space-y-2">
        <h1 className="text-[22px] font-bold leading-[1.35] tracking-tight text-foreground">계정을 확인하지 못했어요</h1>
        <p className="text-[14px] leading-relaxed text-muted-foreground">
          브라우저가 쿠키를 막고 있으면 이럴 수 있어요. 쇼핑몰에서 결제수단 등록을 다시 시작해 주세요.
        </p>
      </div>
      <a
        href={returnUrl}
        className="flex h-14 w-full items-center justify-center rounded-md bg-primary text-[16px] font-semibold text-primary-foreground"
      >
        쇼핑몰로 돌아가기
      </a>
    </div>
  );
}
