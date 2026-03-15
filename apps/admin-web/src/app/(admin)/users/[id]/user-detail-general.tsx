'use client'

import { Container } from "@/components/admin-ui-experimental/container"
import { Header } from "@/components/admin-ui-experimental/header"

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