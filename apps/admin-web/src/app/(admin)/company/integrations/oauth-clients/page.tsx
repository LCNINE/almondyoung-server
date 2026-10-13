import RouteGuard from '@/components/layout/route-guard';
import OAuthClientsTemplate from '@/features/oauth-clients/template';

export default function OAuthClientsPage() {
  return (
    <RouteGuard screen="/company/integrations/oauth-clients">
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <OAuthClientsTemplate />
      </div>
    </RouteGuard>
  );
}
