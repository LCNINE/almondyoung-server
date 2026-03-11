// import RouteGuard from '@/components/layout/route-guard';
import MainTemplate from '@/features/main/template/MainTemplate';

export default function HomePage() {
  return (
    // <RouteGuard
    //   requireRole={['admin', 'master']}
    // >
      <MainTemplate />
    // </RouteGuard>
  );
}


//가장큰 라우트가드 임시 비활성화 처리