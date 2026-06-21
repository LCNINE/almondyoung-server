import { TwoColumnPage } from "@/components/admin-ui-experimental/layout";
import { UserDetailGeneral } from "./user-detail-general";
import { UserDetailRole } from "./user-detail-role";

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
      <TwoColumnPage>
        <UserDetailGeneral userId={id} />
        <UserDetailRole userId={id} />
      </TwoColumnPage>
    </div>
  )
}
