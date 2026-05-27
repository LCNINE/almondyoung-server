'use client';

import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { BusinessLicenseTable } from '../components/table';

export default function BusinessLicenseListTemplate() {
  return (
    <Container className="divide-y-0">
      <Header title="사업자 인증 검토" />
      <BusinessLicenseTable />
    </Container>
  );
}
