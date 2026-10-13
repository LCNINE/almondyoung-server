import RouteGuard from '@/components/layout/route-guard';
import ProductRegistrationClient from './(components)/product-registration.client';

export default function ProductRegistrationPage() {
  return (
    <RouteGuard screen="/mall/product-registration">
      <ProductRegistrationClient />
    </RouteGuard>
  );
}

