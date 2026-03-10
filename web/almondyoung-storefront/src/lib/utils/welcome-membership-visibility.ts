// 일단 임시로 웰컴멤버십 노출 안되게
const HIDDEN_WELCOME_CATEGORY_NAMES = ["100원 웰컴딜"]
const HIDDEN_WELCOME_CATEGORY_HANDLES = ["100원-웰컴딜", "100won-welcome-deal"]
const HIDDEN_WELCOME_PRODUCT_TITLE_PREFIX = "[웰컴 멤버십]"

export function shouldHideWelcomeCategory(input: {
  name?: string | null
  handle?: string | null
}) {
  const name = input.name?.trim() ?? ""
  const handle = input.handle?.trim() ?? ""

  return (
    HIDDEN_WELCOME_CATEGORY_NAMES.includes(name) ||
    HIDDEN_WELCOME_CATEGORY_HANDLES.includes(handle)
  )
}

export function shouldHideWelcomeMembershipProductByTitle(
  title?: string | null
) {
  const normalized = title?.trim() ?? ""
  return normalized.startsWith(HIDDEN_WELCOME_PRODUCT_TITLE_PREFIX)
}

