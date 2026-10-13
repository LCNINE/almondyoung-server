import { AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { permissionLabel } from '@/lib/auth/permission-labels';
import { ForbiddenActions } from './forbidden-actions';

export function ForbiddenPanel({ required }: { required: readonly string[] }) {
  const labels = required.map(permissionLabel);
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
            <AlertTriangle className="h-6 w-6 text-red-600" />
          </div>
          <CardTitle className="text-red-600">접근 권한이 없습니다</CardTitle>
          <CardDescription>
            이 화면에는 <strong className="text-gray-900">{labels.join(' 또는 ')}</strong> 권한이 필요합니다. 관리자에게 요청하세요.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ForbiddenActions permissionKeys={[...required]} />
        </CardContent>
      </Card>
    </div>
  );
}

export function PermissionUnavailablePanel() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle>권한 정보를 불러오지 못했습니다</CardTitle>
          <CardDescription>잠시 뒤 다시 시도하세요. 계속되면 관리자에게 알려 주세요.</CardDescription>
        </CardHeader>
        <CardContent>
          <ForbiddenActions permissionKeys={[]} retry />
        </CardContent>
      </Card>
    </div>
  );
}
