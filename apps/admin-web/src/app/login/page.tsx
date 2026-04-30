import { redirect } from 'next/navigation';

// 로그인 UI는 auth-web으로 일원화. 기존 LoginTemplate은 디자인 참조용으로 보존:
// import LoginTemplate from '@/features/login/template/page';
// import { Suspense } from 'react';
// export default function LoginPage() {
//   return (
//     <Suspense>
//       <LoginTemplate />
//     </Suspense>
//   );
// }

const AUTH_WEB_ORIGIN = process.env.AUTH_WEB_ORIGIN ?? '';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect_to?: string }>;
}) {
  const params = await searchParams;
  const url = new URL('/signin', AUTH_WEB_ORIGIN);
  if (params.redirect_to) {
    url.searchParams.set('redirect_to', params.redirect_to);
  }
  redirect(url.toString());
}
