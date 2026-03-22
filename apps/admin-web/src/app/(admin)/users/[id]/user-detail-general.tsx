'use client'

import { Suspense } from 'react'
import { Container } from "@/components/admin-ui-experimental/common/container"
import { Header } from "@/components/admin-ui-experimental/common/header"
import { Spinner } from '@/components/ui/spinner'
import { useAdminUser } from '@/lib/services/users'

export function UserDetailGeneralContent({ userId }: { userId: string }) {
  const { data } = useAdminUser(userId)

  const rows: { key: string; value: string | null }[] = [
    { key: '로그인 ID', value: data.loginId },
    { key: '이름', value: data.username },
    { key: '닉네임', value: data.nickname },
    { key: '이메일', value: data.email },
    { key: '가입일', value: data.createdAt },
  ]

  return (
    <div>
      {rows.map(({ key, value }) => (
        <div key={key} className="grid grid-cols-2 p-3">
          <div className="text-sm font-medium text-gray-500">{key}</div>
          <div className="text-sm">{value ?? '-'}</div>
        </div>
      ))}
    </div>
  )
}

export function UserDetailGeneral({ userId }: { userId: string }) {
  return (
    <Container className="divide-y">
      <Header title="기본 정보" />
      <Suspense fallback={<div className="flex justify-center p-4"><Spinner /></div>}>
        <UserDetailGeneralContent userId={userId} />
      </Suspense>
    </Container>
  )
} 
