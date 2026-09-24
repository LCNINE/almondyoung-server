'use client';

import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { ContestPeriod } from '../components/contest-period';
import { LogoContestEntryTable } from '../components/table';

export default function LogoContestEntryListTemplate() {
  return (
    <Container>
      <ContestPeriod />
      <LogoContestEntryTable />
    </Container>
  );
}
