'use client'

import { Container } from "@/components/admin-ui-experimental/common/container"
import { Header } from "@/components/admin-ui-experimental/common/header"

type UserDetailGeneralProps = {
  userId: string,
}
export function UserDetailGeneral({ userId }: UserDetailGeneralProps) {
  return (
    <Container className="divide-y">
      <Header title="기본 정보"/>

    </Container>
  )
}