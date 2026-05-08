import Link from "next/link";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function NoMasterScopeNotice() {
  return (
    <Alert>
      <AlertTitle>권한이 부족합니다</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>
          이 페이지는 <code className="font-mono">master</code> scope 가 부여된 계정에서만 사용할 수 있습니다.
          현재 로그인한 계정에는 해당 권한이 없습니다.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href="/signin?next=/dev/oidc-clients">다른 계정으로 로그인</Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}
