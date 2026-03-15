"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { X } from "lucide-react"

interface WidgetCardProps {
  title?: string
  onClose?: () => void
  children: React.ReactNode
}

export function WidgetCard({ title, onClose, children }: WidgetCardProps) {
  return (
    <Card className="relative border-[0.5px] px-5 pt-3 pb-4 shadow-xl">
      <CardHeader className="mb-4 p-0">
        <CardTitle className="flex items-center justify-between text-lg font-bold">
          {title}

          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="group h-8 w-8 cursor-pointer hover:bg-transparent hover:text-black"
          >
            <X
              className="h-5 w-5 transition-all duration-300 group-hover:scale-110"
              strokeWidth={3}
            />
          </Button>
        </CardTitle>
      </CardHeader>

      <CardContent className="p-0">{children}</CardContent>
    </Card>
  )
}
