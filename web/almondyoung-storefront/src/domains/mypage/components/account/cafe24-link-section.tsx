"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Spinner } from "@/components/shared/spinner"
import {
  Cafe24MigrationItem,
  Cafe24MigrationKey,
  getCafe24Migration,
  migrateCafe24Item,
} from "@lib/api/users/cafe24"
import { AlertCircle, Link2, RefreshCw } from "lucide-react"
import { useParams, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useState, useTransition } from "react"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

const CAFE24_MIGRATOR_BASE =
  "https://almondyoung.com/migrator/confirm.html"

const KEY_LABELS: Record<Cafe24MigrationKey, string> = {
  email: "이메일",
  name: "이름",
  birthday: "생년월일",
  phone: "휴대폰 번호",
}

const STATUS_LABELS = {
  synced: "동기화됨",
  out_of_sync: "차이 있음",
  missing: "미등록",
} as const

const STATUS_BADGE_CLASS: Record<
  Cafe24MigrationItem["status"],
  string
> = {
  synced: "border-green-200 bg-green-100 text-green-700",
  out_of_sync: "border-amber-200 bg-amber-100 text-amber-700",
  missing: "border-gray-200 bg-gray-100 text-gray-600",
}

const LINK_STATUS_MESSAGES: Record<
  string,
  { title: string; description: string; variant?: "default" | "destructive" }
> = {
  success: {
    title: "연결이 완료되었습니다.",
    description: "이관 항목을 확인하고 필요한 정보를 가져오세요.",
  },
  missing_token: {
    title: "연결 토큰을 찾을 수 없습니다.",
    description: "기존 아몬드영 연결을 다시 시작해주세요.",
    variant: "destructive",
  },
  invalid_token: {
    title: "연결 토큰이 유효하지 않습니다.",
    description: "토큰이 만료되었거나 이미 사용되었습니다. 다시 연결해주세요.",
    variant: "destructive",
  },
  failed: {
    title: "계정 연결에 실패했습니다.",
    description: "잠시 후 다시 시도하거나 연결 버튼으로 다시 진행해주세요.",
    variant: "destructive",
  },
  login_required: {
    title: "로그인이 필요합니다.",
    description: "로그인 후 기존 아몬드영 연결을 다시 진행해주세요.",
    variant: "destructive",
  },
}

const formatValue = (value: string | null) => value ?? "-"

export function Cafe24LinkSection() {
  const { countryCode } = useParams() as { countryCode: string }
  const searchParams = useSearchParams()
  const linkStatus = searchParams.get("link")

  const [items, setItems] = useState<Cafe24MigrationItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [activeKey, setActiveKey] = useState<Cafe24MigrationKey | null>(null)
  const [isPending, startTransition] = useTransition()

  const linkMessage = linkStatus ? LINK_STATUS_MESSAGES[linkStatus] : null

  const postUrl = useMemo(() => {
    if (typeof window === "undefined") return ""
    return `${window.location.origin}/${countryCode}/mypage/account/cafe24/confirm`
  }, [countryCode])

  const cafe24RedirectUrl = useMemo(() => {
    if (!postUrl) return ""
    return `${CAFE24_MIGRATOR_BASE}?redirect_to=${encodeURIComponent(postUrl)}`
  }, [postUrl])

  const loadMigration = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await getCafe24Migration()

      if ("error" in response && response.error) {
        const { status, message } = response.error

        if (status === 400 || status === 404) {
          // 연결 전 상태로 간주
          setItems([])
          setError(null)
          return
        }

        if (status === 401 || status === 403) {
          setError("로그인이 필요합니다.")
          setItems(null)
          return
        }

        setError(message ?? "이관 정보를 불러오는데 실패했습니다.")
        setItems(null)
        return
      }

      if ("data" in response) {
        setItems(response.data ?? [])
      }
    } catch (loadError: any) {
      console.error("Cafe24 migration load failed:", loadError)
      const message =
        loadError?.message ?? "이관 정보를 불러오는데 실패했습니다."
      setError(message)
      setItems(null)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadMigration()
  }, [loadMigration])

  useEffect(() => {
    if (!linkStatus) return

    const message = LINK_STATUS_MESSAGES[linkStatus]
    if (!message) return

    if (message.variant === "destructive") {
      toast.error(message.title)
    } else {
      toast.success(message.title)
    }

    if (linkStatus === "success") {
      loadMigration()
    }
  }, [linkStatus, loadMigration])

  const handleStartLink = () => {
    if (!cafe24RedirectUrl) return
    window.location.href = cafe24RedirectUrl
  }

  const handleMigrate = (key: Cafe24MigrationKey) => {
    startTransition(async () => {
      setActiveKey(key)
      try {
        const response = await migrateCafe24Item(key)

        if ("error" in response && response.error) {
          const message =
            response.error.status === 401 || response.error.status === 403
              ? "로그인이 필요합니다."
              : response.error.message ??
                "이관에 실패했습니다. 다시 시도해주세요."
          toast.error(message)
          return
        }

        toast.success("이관이 완료되었습니다.")
        await loadMigration()
      } catch (migrationError: any) {
        console.error("Cafe24 migration failed:", migrationError)
        toast.error(
          migrationError?.message ?? "이관에 실패했습니다. 다시 시도해주세요."
        )
      } finally {
        setActiveKey(null)
      }
    })
  }

  const handleRetry = () => {
    loadMigration()
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">기존 아몬드영 계정 연결</CardTitle>
          <CardDescription>
            기존 아몬드영에 등록된 정보를 가져와 계정 정보를 최신으로 유지할 수
            있습니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {linkMessage && (
            <Alert
              variant={linkMessage.variant ?? "default"}
              className="mb-4"
            >
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>{linkMessage.title}</AlertTitle>
              <AlertDescription>{linkMessage.description}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1 text-sm text-gray-600">
              <p>
                기존 아몬드영 계정으로 로그인한 상태에서 연결을 진행해주세요.
              </p>
              <p className="text-xs text-gray-400">
                연결 토큰은 1회용이며 만료 시간이 있습니다.
              </p>
            </div>
            <Button
              type="button"
              onClick={handleStartLink}
              className="gap-2"
            >
              <Link2 className="h-4 w-4" />
              기존 아몬드영 계정 연결
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle className="text-lg">이관 항목</CardTitle>
            <CardDescription>
              기존 아몬드영 계정과 현재 계정의 차이를 확인하고 필요한 정보를 이관하세요.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRetry}
            disabled={isLoading}
            className="gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            새로고침
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex h-40 items-center justify-center">
              <Spinner size="lg" color="gray" />
            </div>
          ) : error ? (
            <div className="rounded-lg border border-dashed border-gray-200 p-4 text-sm text-gray-500">
              {error}
            </div>
          ) : items && items.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[140px]">항목</TableHead>
                  <TableHead className="w-[120px]">상태</TableHead>
                  <TableHead>기존 아몬드영 값</TableHead>
                  <TableHead>현재 값</TableHead>
                  <TableHead className="w-[120px] text-right">
                    작업
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => {
                  const isSynced = item.status === "synced"
                  const hasCafe24Value = item.cafe24Value !== null
                  const isActionable = !isSynced && hasCafe24Value
                  const isRowPending = activeKey === item.key && isPending

                  return (
                    <TableRow key={item.key}>
                      <TableCell className="font-medium">
                        {KEY_LABELS[item.key]}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={STATUS_BADGE_CLASS[item.status]}
                        >
                          {STATUS_LABELS[item.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-gray-700">
                        {formatValue(item.cafe24Value)}
                      </TableCell>
                      <TableCell className="text-sm text-gray-500">
                        {formatValue(item.userValue)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => handleMigrate(item.key)}
                          disabled={!isActionable || isRowPending}
                        >
                          {isSynced ? "완료" : isRowPending ? "이관 중..." : "이관"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="rounded-lg border border-dashed border-gray-200 p-4 text-sm text-gray-500">
              이관 항목이 없습니다. 먼저 기존 아몬드영 계정을 연결해주세요.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
