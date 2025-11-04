"use client"

import { createContext, useContext, useState, ReactNode } from "react"
import { ChevronDown } from "lucide-react"

// Context 타입 정의
interface AccordionContextType {
  openId: string | null
  toggle: (id: string) => void
}

// Context 생성
const AccordionContext = createContext<AccordionContextType | undefined>(
  undefined
)

// Context Hook
const useAccordion = () => {
  const context = useContext(AccordionContext)
  if (!context) {
    throw new Error(
      "Accordion 컴포넌트는 Accordion.Root 내부에서 사용해야 합니다."
    )
  }
  return context
}

// Root 컴포넌트
interface RootProps {
  children: ReactNode
  defaultValue?: string
  className?: string
}

function Root({ children, defaultValue, className = "" }: RootProps) {
  const [openId, setOpenId] = useState<string | null>(defaultValue || null)

  const toggle = (id: string) => {
    setOpenId(openId === id ? null : id)
  }

  return (
    <AccordionContext.Provider value={{ openId, toggle }}>
      <div className={className}>{children}</div>
    </AccordionContext.Provider>
  )
}

// Item 컴포넌트
interface ItemProps {
  children: ReactNode
  value: string
  className?: string
}

function Item({ children, value, className = "" }: ItemProps) {
  return (
    <article
      className={`border-b border-gray-300 ${className}`}
      data-value={value}
    >
      {children}
    </article>
  )
}

// Trigger 컴포넌트
interface TriggerProps {
  children: ReactNode
  value: string
  className?: string
}

function Trigger({ children, value, className = "" }: TriggerProps) {
  const { openId, toggle } = useAccordion()
  const isOpen = openId === value

  return (
    <button
      type="button"
      onClick={() => toggle(value)}
      className={`relative flex h-[50px] w-full cursor-pointer items-center px-4 text-left text-[15px] hover:bg-gray-50 ${className}`}
    >
      <span className="mr-5 text-lg font-bold text-blue-600">Q</span>
      <span className="flex-1">{children}</span>
      <ChevronDown
        className={`h-5 w-5 text-blue-600 transition-transform ${
          isOpen ? "rotate-180" : ""
        }`}
      />
    </button>
  )
}

// Content 컴포넌트
interface ContentProps {
  children: ReactNode
  value: string
  className?: string
}

function Content({ children, value, className = "" }: ContentProps) {
  const { openId } = useAccordion()
  const isOpen = openId === value

  if (!isOpen) return null

  return (
    <div className={`border-gray-30 border-t bg-gray-50 pt-5 ${className}`}>
      <div className="flex px-4 pb-5">
        <span className="mr-2.5 ml-4 w-4 text-lg font-bold text-red-900">
          A
        </span>
        <div className="mr-4 flex-1 space-y-4 rounded border border-gray-300 bg-gray-50 p-6 text-sm leading-relaxed tracking-tight text-gray-900">
          {children}
        </div>
      </div>
    </div>
  )
}

// Composite 패턴으로 export
export const Accordion = {
  Root,
  Item,
  Trigger,
  Content,
}
