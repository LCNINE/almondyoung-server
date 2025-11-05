"use client"

import * as React from "react"
import { ChevronRight } from "lucide-react"

import { Button } from "@components/common/ui/button"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@components/common/ui/drawer"

interface AgreementDrawerProps {
  title: string
  content: string | null
  onCheckedChange?: () => void
}

export function AgreementDrawer({
  title,
  content,
  onCheckedChange,
}: AgreementDrawerProps) {
  return (
    <Drawer>
      <DrawerTrigger asChild>
        <Button
          variant="ghost"
          className="h-5 cursor-pointer p-0! hover:bg-transparent"
          size="sm"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </DrawerTrigger>
      <DrawerContent className="max-h-[90vh]">
        <div className="mx-auto w-full max-w-2xl">
          <DrawerHeader>
            <DrawerTitle>{title}</DrawerTitle>
            <DrawerDescription>
              아래 내용을 자세히 읽어보시고 동의해 주세요.
            </DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-0">
            <div className="max-h-[60vh] overflow-y-auto rounded-lg border p-4">
              {content ? (
                <div className="text-muted-foreground text-sm leading-relaxed whitespace-pre-wrap">
                  {content}
                </div>
              ) : (
                <div className="text-muted-foreground text-center text-sm">
                  약관 내용이 없습니다.
                </div>
              )}
            </div>
          </div>
          <DrawerFooter>
            <DrawerClose asChild>
              <Button variant="outline" onClick={onCheckedChange}>
                확인
              </Button>
            </DrawerClose>
          </DrawerFooter>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
