import LoginTemplate from '@/features/login/template/page';
import { Suspense } from 'react';

export default function LoginPage() {
  return (
    <Suspense>
      <LoginTemplate />
    </Suspense>
  );
}
