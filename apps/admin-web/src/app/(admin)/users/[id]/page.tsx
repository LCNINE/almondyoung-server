import { UserDetailGeneral } from "./user-detail-general";

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
      <UserDetailGeneral userId={id} />
    </div>
  )
}