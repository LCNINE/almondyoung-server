export type CustomerGroupRef = {
  id?: string | null
}

export const getMembershipGroupIdFromEnv = () =>
  (
    process.env.NEXT_PUBLIC_MEDUSA_MEMBERSHIP_GROUP_ID ??
    process.env.MEDUSA_MEMBERSHIP_GROUP_ID ??
    ""
  ).trim()

export const isMembershipGroupById = (
  groups: CustomerGroupRef[] | null | undefined,
  membershipGroupId: string
): boolean => {
  if (!membershipGroupId) return false
  return !!groups?.some((group) => group?.id === membershipGroupId)
}

export const isMembershipGroup = (
  groups?: CustomerGroupRef[] | null
): boolean => {
  return isMembershipGroupById(groups, getMembershipGroupIdFromEnv())
}
