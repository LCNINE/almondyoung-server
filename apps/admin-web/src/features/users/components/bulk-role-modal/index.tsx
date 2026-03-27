'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Spinner } from '@/components/ui/spinner'
import { roleApi } from '@/lib/api/domains/roles'
import { userApi } from '@/lib/api/domains/users'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { usersQueryKeys } from '@/lib/services/users'
import { rolesQueryKeys } from '@/lib/services/roles'
import { toast } from 'sonner'

type BulkRoleModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedUserIds: string[]
  onSuccess?: () => void
}

export function BulkRoleModal({
  open,
  onOpenChange,
  selectedUserIds,
  onSuccess,
}: BulkRoleModalProps) {
  const { data: allRoles, isLoading } = useQuery({
    queryKey: rolesQueryKeys.list(),
    queryFn: () => roleApi.listRoles(),
    enabled: open,
  })
  const queryClient = useQueryClient()
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleToggle = (roleId: string) => {
    setSelectedRoleIds((prev) =>
      prev.includes(roleId)
        ? prev.filter((id) => id !== roleId)
        : [...prev, roleId]
    )
  }

  const handleSubmit = async () => {
    if (selectedRoleIds.length === 0) {
      toast.error('역할을 선택해주세요.')
      return
    }

    setIsSubmitting(true)
    try {
      await Promise.all(
        selectedUserIds.map((userId) =>
          userApi.replaceUserRoles(userId, { roleIds: selectedRoleIds })
        )
      )
      toast.success(`${selectedUserIds.length}명의 역할이 변경되었습니다.`)
      queryClient.invalidateQueries({ queryKey: usersQueryKeys.all })
      setSelectedRoleIds([])
      onOpenChange(false)
      onSuccess?.()
    } catch (error: any) {
      toast.error(error.message || '역할 변경에 실패했습니다.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleClose = () => {
    setSelectedRoleIds([])
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>역할 일괄 부여</DialogTitle>
          <DialogDescription>
            선택된 {selectedUserIds.length}명의 사용자에게 역할을 부여합니다.
            기존 역할은 선택한 역할로 대체됩니다.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-3">
          {isLoading ? (
            <div className="flex justify-center py-4">
              <Spinner />
            </div>
          ) : allRoles?.map((role) => (
            <label
              key={role.roleId}
              className="flex items-center gap-3 cursor-pointer"
            >
              <Checkbox
                checked={selectedRoleIds.includes(role.roleId)}
                onCheckedChange={() => handleToggle(role.roleId)}
              />
              <div>
                <div className="font-medium">{role.name}</div>
                {role.description && (
                  <div className="text-sm text-muted-foreground">
                    {role.description}
                  </div>
                )}
              </div>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            취소
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={selectedRoleIds.length === 0 || isSubmitting}
          >
            {isSubmitting ? '적용 중...' : '적용'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
