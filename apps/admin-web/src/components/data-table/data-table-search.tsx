'use client'

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { useSelectedParams } from '@/hooks/table/use-selected-params'

type DataTableSearchProps = {
  prefix?: string
  placeholder?: string
  /** Enter 로 바로 검색하고 글자를 골라 둔다 — 스캐너로 이어 찍으면 앞 검색어를 덮어쓴다 */
  submitOnEnter?: boolean
}

export function DataTableSearch({ prefix, placeholder = '검색...', submitOnEnter }: DataTableSearchProps) {
  const { get, add, delete: del } = useSelectedParams({ prefix })
  const raw = get('q')
  const currentValue = Array.isArray(raw) ? raw[0] : (raw ?? '')

  const [value, setValue] = useState(currentValue)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  // 마지막으로 보낸 뒤 새로 친 글자가 있으면 늦게 도착한 주소가 그 글자를 덮지 않는다
  const typingRef = useRef(false)
  const reselectRef = useRef(false)

  useEffect(() => {
    if (typingRef.current) return

    setValue(currentValue)
    reselectRef.current = !!submitOnEnter && document.activeElement === inputRef.current
  }, [currentValue, submitOnEnter])

  useEffect(() => {
    if (!reselectRef.current) return

    reselectRef.current = false
    inputRef.current?.select()
  }, [value])

  const apply = (val: string) => {
    typingRef.current = false
    if (val) add('q', val)
    else del('q')
  }

  const handleChange = (val: string) => {
    typingRef.current = true
    setValue(val)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => apply(val), 500)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!submitOnEnter || e.key !== 'Enter') return

    e.preventDefault()
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null

    apply(e.currentTarget.value)
    e.currentTarget.select()
  }

  return (
    <div className="relative">
      <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        className="h-8 pl-8 text-sm"
        ref={inputRef}
        aria-label={placeholder}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
      />
    </div>
  )
}
