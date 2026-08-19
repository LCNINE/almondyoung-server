import Script from 'next/script';
import { Toaster } from '@/components/ui/sonner';

export const metadata = {
  robots: { index: false, follow: false },
};

export default function CheckoutLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* 배송지 등록/수정의 우편번호 검색. storefront (checkout)/layout.tsx 와 동일하게 lazyOnload. */}
      <Script src="//t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js" strategy="lazyOnload" />
      {children}
      <Toaster position="top-center" richColors />
    </>
  );
}
