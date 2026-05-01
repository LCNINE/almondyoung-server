export const WELCOME_MEMBERSHIP_TAG = "welcome-membership"

export function isWelcomeMembershipProduct(
  tags?: Array<{ value: string }> | null
): boolean {
  return (tags ?? []).some((tag) => tag.value === WELCOME_MEMBERSHIP_TAG)
}
