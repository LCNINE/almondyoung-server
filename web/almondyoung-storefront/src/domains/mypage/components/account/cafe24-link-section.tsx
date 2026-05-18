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
import { useTranslations } from "next-intl"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useState, useTransition } from "react"
import { toast } from "sonner"

const CAFE24_MIGRATOR_BASE =
  "https://almondyoung.com/migrator/confirm.html"

const KEY_I18N: Record<Cafe24MigrationKey, string> = {
  email: "email",
  name: "name",
  birthday: "birthday",
  phone: "phone",
}

const STATUS_I18N: Record<Cafe24MigrationItem["status"], string> = {
  synced: "same",
  out_of_sync: "migratable",
  missing: "notMigratable",
}

const STATUS_BADGE_CLASS: Record<
  Cafe24MigrationItem["status"],
  string
> = {
  synced: "border-green-200 bg-green-100 text-green-700",
  out_of_sync: "border-amber-200 bg-amber-100 text-amber-700",
  missing: "border-gray-200 bg-gray-100 text-gray-600",
}

const LINK_STATUS_MAP: Record<
  string,
  { titleKey: string; variant?: "default" | "destructive" }
> = {
  success: { titleKey: "linked" },
  missing_token: { titleKey: "tokenNotFound", variant: "destructive" },
  invalid_token: { titleKey: "invalidToken", variant: "destructive" },
  failed: { titleKey: "linkFailed", variant: "destructive" },
  login_required: { titleKey: "loginRequired", variant: "destructive" },
}

const formatValue = (value: string | null) => value ?? "-"
const formatLinkedAt = (value?: string | null) =>
  value ? new Date(value).toLocaleDateString() : "-"

export function Cafe24LinkSection() {
  const t = useTranslations("mypage.account.cafe24")
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
          setError(t("loginRequired"))
          setItems(null)
          return
        }

        setError(message ?? t("loadFailed"))
        setItems(null)
        return
      }

      if ("data" in response) {
        setItems(response.data ?? [])
      }
    } catch (loadError: any) {
      console.error("Cafe24 migration load failed:", loadError)
      const message = loadError?.message ?? t("loadFailed")
      setError(message)
      setItems(null)
    } finally {
      setIsLoading(false)
    }
  }, [t])

  useEffect(() => {
    loadLinkInfo()
    loadMigration()
  }, [loadLinkInfo, loadMigration])

  useEffect(() => {
    if (!linkStatus) return

    const message = LINK_STATUS_MAP[linkStatus]
    if (!message) return

    const text = t(message.titleKey)
    if (message.variant === "destructive") {
      toast.error(text)
    } else {
      toast.success(text)
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
  }, [linkStatus, loadLinkInfo, loadMigration, countryCode, router, searchParams, t])

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
              ? t("loginRequired")
              : response.error.message ?? t("migrationFailed")
          toast.error(message)
          return
        }

        toast.success(t("migrationSuccess"))
        await loadMigration()
      } catch (migrationError: any) {
        console.error("Cafe24 migration failed:", migrationError)
        toast.error(migrationError?.message ?? t("migrationFailed"))
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
            ? t("loginRequired")
            : response.error.message ?? t("unlinkFailed")
        toast.error(message)
        return
      }

      toast.success(t("unlinked"))
      setLinkInfo(null)
      await loadMigration()
    } catch (unlinkError: any) {
      console.error("Cafe24 unlink failed:", unlinkError)
      toast.error(unlinkError?.message ?? t("unlinkFailedRetry"))
    } finally {
      setIsUnlinkPending(false)
    }
  }

  return (
    <div className="space-y-6">
      {isLinkInfoLoading ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("title")}</CardTitle>
            <CardDescription>{t("cardDescription")}</CardDescription>
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
            <CardTitle className="text-lg">{t("linkedTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 text-sm text-gray-700">
              <div className="flex items-center justify-between">
                <span className="text-gray-500">{t("linkedId")}</span>
                <span className="font-medium">
                  {formatValue(linkInfo.cafe24MemberId)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">{t("linkedAt")}</span>
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
            <CardTitle className="text-lg">{t("title")}</CardTitle>
            <CardDescription>{t("cardDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="space-y-1 text-sm text-gray-600">
                <p>{t("startLinkHint")}</p>
                <p className="text-xs text-gray-400">{t("tokenInfo")}</p>
              </div>
              <Button
                type="button"
                onClick={handleStartLink}
                className="gap-2"
              >
                <Link2 className="h-4 w-4" />
                {t("startLink")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!isLinkInfoLoading && linkInfo && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <div>
              <CardTitle className="text-lg">{t("migrationTitle")}</CardTitle>
              <CardDescription>{t("migrationDescription")}</CardDescription>
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
              {t("refresh")}
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
                        <TableHead className="w-[140px]">
                          {t("tableHeaders.item")}
                        </TableHead>
                        <TableHead className="w-[120px]">
                          {t("tableHeaders.status")}
                        </TableHead>
                        <TableHead>{t("tableHeaders.previous")}</TableHead>
                        <TableHead>{t("tableHeaders.current")}</TableHead>
                        <TableHead className="w-[120px] text-right">
                          {t("tableHeaders.action")}
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
                              {t(`keys.${KEY_I18N[item.key]}`)}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={STATUS_BADGE_CLASS[item.status]}
                              >
                                {t(`status.${STATUS_I18N[item.status]}`)}
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
                                  ? t("migrated")
                                  : isRowPending
                                    ? t("migrating")
                                    : t("migrate")}
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
                            {t(`keys.${KEY_I18N[item.key]}`)}
                          </span>
                          <Badge
                            variant="outline"
                            className={STATUS_BADGE_CLASS[item.status]}
                          >
                            {t(`status.${STATUS_I18N[item.status]}`)}
                          </Badge>
                        </div>
                        <div className="mt-3 space-y-2 text-gray-600">
                          <div className="flex items-center gap-2">
                            <span className="shrink-0 text-xs font-medium text-gray-500">
                              {t("previous")}
                            </span>
                            <span className="ml-auto max-w-full truncate text-right">
                              {formatValue(item.cafe24Value)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="shrink-0 text-xs font-medium text-gray-500">
                              {t("current")}
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
                              ? t("migrated")
                              : isRowPending
                                ? t("migrating")
                                : t("migrate")}
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-dashed border-gray-200 p-4 text-sm text-gray-500">
                {t("noMigrationItems")}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!isLinkInfoLoading && linkInfo && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {t("unlinkSectionTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <p className="text-sm text-gray-600">
                {t("unlinkSectionDescription")}
              </p>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={isUnlinkPending}
                  >
                    {t("unlink")}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t("unlink")}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("unlinkConfirm")}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={isUnlinkPending}>
                      {t("cancel")}
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleUnlink}
                      disabled={isUnlinkPending}
                      className={buttonVariants({ variant: "destructive" })}
                    >
                      {t("unlink")}
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
