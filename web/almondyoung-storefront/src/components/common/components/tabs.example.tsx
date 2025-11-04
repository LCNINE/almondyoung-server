"use client"

import React from "react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./tabs"

// 첫 번째 예시: 기본 탭
export const BasicTabsExample = () => (
  <section className="w-[700px]">
    <Tabs defaultValue="tab1">
      <TabsList>
        <TabsTrigger value="tab1">구매</TabsTrigger>
        <TabsTrigger value="tab2">자주 산 상품</TabsTrigger>
        <TabsTrigger value="tab3">찜한 상품</TabsTrigger>
      </TabsList>
      <TabsContent value="tab1">탭 1의 내용입니다.</TabsContent>
      <TabsContent value="tab2">탭 2의 내용입니다.</TabsContent>
      <TabsContent value="tab3">탭 3의 내용입니다.</TabsContent>
    </Tabs>
  </section>
)

export const DisabledTabExample = () => (
  <section className="w-[700px]">
    <Tabs defaultValue="tab1">
      <TabsList>
        <TabsTrigger value="tab1">활성 탭</TabsTrigger>
        <TabsTrigger value="tab2" disabled>
          비활성 탭
        </TabsTrigger>
        <TabsTrigger value="tab3">탭 3</TabsTrigger>
      </TabsList>
      <TabsContent value="tab1">활성 탭의 내용입니다.</TabsContent>
      <TabsContent value="tab2">비활성 탭의 내용입니다.</TabsContent>
      <TabsContent value="tab3">탭 3의 내용입니다.</TabsContent>
    </Tabs>
  </section>
)
// 필요하면 이렇게 한 파일에서 기본 내보내기도 가능
export default function TabsExamplesPage() {
  return (
    <main className="space-y-10">
      <BasicTabsExample />
      <DisabledTabExample />
    </main>
  )
}
