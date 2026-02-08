"use client"

import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
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
  Cafe24LinkResult,
  Cafe24MigrationItem,
  Cafe24MigrationKey,
  getCafe24LinkInfo,
  getCafe24Migration,
  migrateCafe24Item,
  unlinkCafe24,
} from "@lib/api/users/cafe24"
import { Link2, RefreshCw } from "lucide-react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useState, useTransition } from "react"
import { toast } from "sonner"

const CAFE24_MIGRATOR_BASE =
  "https://almondyoung.com/migrator/confirm.html"

const KEY_LABELS: Record<Cafe24MigrationKey, string> = {
  email: "이메일",
  name: "이름",
  birthday: "생년월일",
  phone: "휴대폰 번호",
}

const STATUS_LABELS = {
  synced: "동일",
  out_of_sync: "이관 가능",
  missing: "이관 불가",
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
const formatLinkedAt = (value?: string | null) =>
  value ? new Date(value).toLocaleDateString("ko-KR") : "-"

export function Cafe24LinkSection() {
  const { countryCode } = useParams() as { countryCode: string }
  const router = useRouter()
  const searchParams = useSearchParams()
  const linkStatus = searchParams.get("link")

  const [linkInfo, setLinkInfo] = useState<Cafe24LinkResult | null>(null)
  const [isLinkInfoLoading, setIsLinkInfoLoading] = useState(true)
  const [items, setItems] = useState<Cafe24MigrationItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isUnlinkPending, setIsUnlinkPending] = useState(false)
  const [activeKey, setActiveKey] = useState<Cafe24MigrationKey | null>(null)
  const [isPending, startTransition] = useTransition()

  const postUrl = useMemo(() => {
    if (typeof window === "undefined") return ""
    return `${window.location.origin}/${countryCode}/mypage/account/cafe24/confirm`
  }, [countryCode])

  const cafe24RedirectUrl = useMemo(() => {
    if (!postUrl) return ""
    return `${CAFE24_MIGRATOR_BASE}?redirect_to=${encodeURIComponent(postUrl)}`
  }, [postUrl])

  const loadLinkInfo = useCallback(async () => {
    setIsLinkInfoLoading(true)

    try {
      const response = await getCafe24LinkInfo()

      if ("error" in response && response.error) {
        const { status } = response.error
        if (status === 401 || status === 403) {
          setLinkInfo(null)
          return
        }
        setLinkInfo(null)
        return
      }

      if ("data" in response) {
        setLinkInfo(response.data ?? null)
      }
    } catch (loadError) {
      console.error("Cafe24 link info load failed:", loadError)
      setLinkInfo(null)
    } finally {
      setIsLinkInfoLoading(false)
    }
  }, [])

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
    loadLinkInfo()
    loadMigration()
  }, [loadLinkInfo, loadMigration])

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
      loadLinkInfo()
      loadMigration()
    }

    const params = new URLSearchParams(searchParams.toString())
    params.delete("link")
    const nextQuery = params.toString()
    const nextPath = nextQuery
      ? `/${countryCode}/mypage/account/cafe24?${nextQuery}`
      : `/${countryCode}/mypage/account/cafe24`
    router.replace(nextPath)
  }, [linkStatus, loadLinkInfo, loadMigration, countryCode, router, searchParams])

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

  const handleUnlink = async () => {
    if (isUnlinkPending) return

    setIsUnlinkPending(true)
    try {
      const response = await unlinkCafe24()

      if ("error" in response && response.error) {
        const message =
          response.error.status === 401 || response.error.status === 403
            ? "로그인이 필요합니다."
            : response.error.message ?? "연결 해제에 실패했습니다."
        toast.error(message)
        return
      }

      toast.success("연결이 해제되었습니다.")
      setLinkInfo(null)
      await loadMigration()
    } catch (unlinkError: any) {
      console.error("Cafe24 unlink failed:", unlinkError)
      toast.error(
        unlinkError?.message ?? "연결 해제에 실패했습니다. 다시 시도해주세요."
      )
    } finally {
      setIsUnlinkPending(false)
    }
  }

  return (
    <div className="space-y-6">
      {isLinkInfoLoading ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">기존 아몬드영 계정 연결</CardTitle>
            <CardDescription>
              기존 아몬드영에 등록된 정보를 가져와 계정 정보를 최신으로 유지할 수
              있습니다.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex h-20 items-center justify-center">
              <Spinner size="lg" color="gray" />
            </div>
          </CardContent>
        </Card>
      ) : linkInfo ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">연결된 계정 정보</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 text-sm text-gray-700">
              <div className="flex items-center justify-between">
                <span className="text-gray-500">연결된 아이디</span>
                <span className="font-medium">
                  {formatValue(linkInfo.cafe24MemberId)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">연결 일자</span>
                <span className="font-medium">
                  {formatLinkedAt(linkInfo.linkedAt)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">기존 아몬드영 계정 연결</CardTitle>
            <CardDescription>
              기존 아몬드영에 등록된 정보를 가져와 계정 정보를 최신으로 유지할 수
              있습니다.
            </CardDescription>
          </CardHeader>
          <CardContent>
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
      )}

      {!isLinkInfoLoading && linkInfo && (
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
              <>
                <div className="hidden md:block">
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
                                {isSynced
                                  ? "완료"
                                  : isRowPending
                                    ? "이관 중..."
                                    : "이관"}
                              </Button>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>

                <div className="space-y-3 md:hidden">
                  {items.map((item) => {
                    const isSynced = item.status === "synced"
                    const hasCafe24Value = item.cafe24Value !== null
                    const isActionable = !isSynced && hasCafe24Value
                    const isRowPending = activeKey === item.key && isPending

                    return (
                      <div
                        key={item.key}
                        className="rounded-lg border border-gray-200 p-4 text-sm"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium">
                            {KEY_LABELS[item.key]}
                          </span>
                          <Badge
                            variant="outline"
                            className={STATUS_BADGE_CLASS[item.status]}
                          >
                            {STATUS_LABELS[item.status]}
                          </Badge>
                        </div>
                        <div className="mt-3 space-y-2 text-gray-600">
                          <div className="flex items-center gap-2">
                            <span className="shrink-0 text-xs font-medium text-gray-500">
                              기존
                            </span>
                            <span className="ml-auto max-w-full truncate text-right">
                              {formatValue(item.cafe24Value)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="shrink-0 text-xs font-medium text-gray-500">
                              현재
                            </span>
                            <span className="ml-auto max-w-full truncate text-right">
                              {formatValue(item.userValue)}
                            </span>
                          </div>
                        </div>
                        <div className="mt-3 flex justify-end">
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => handleMigrate(item.key)}
                            disabled={!isActionable || isRowPending}
                          >
                            {isSynced
                              ? "완료"
                              : isRowPending
                                ? "이관 중..."
                                : "이관"}
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-dashed border-gray-200 p-4 text-sm text-gray-500">
                이관 항목이 없습니다. 먼저 기존 아몬드영 계정을 연결해주세요.
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!isLinkInfoLoading && linkInfo && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">연결 해제</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <p className="text-sm text-gray-600">
                연결을 해제한 뒤에도 다시 연결할 수 있습니다.
              </p>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={isUnlinkPending}
                  >
                    연결 해제
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>연결 해제</AlertDialogTitle>
                    <AlertDialogDescription>
                      기존 아몬드영 계정 연결을 해제하시겠습니까? 해제 후에도
                      다시 연결할 수 있습니다.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={isUnlinkPending}>
                      취소
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleUnlink}
                      disabled={isUnlinkPending}
                      className={buttonVariants({ variant: "destructive" })}
                    >
                      연결 해제
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
