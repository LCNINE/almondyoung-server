import Footer from "@/components/layout/footer"
import { BottomNavigation } from "@/components/layout/nav/bottom-nav"
import { FloatingButtons } from "@/components/shared/custom-buttons/floating-buttons"
import { CartProvider } from "@/contexts/cart-context"
import {
  MembershipContextType,
  MembershipProvider,
} from "@/contexts/membership-context"
import { UserProvider } from "@/contexts/user-context"
import { WishlistProvider } from "@/contexts/wishlist-context"
import "@/styles/globals.css"
import { retrieveCart } from "@lib/api/medusa/cart"
import { retrieveCustomer } from "@lib/api/medusa/customer"
import { getCurrentSubscription } from "@/lib/api/membership"
import { fetchMe } from "@lib/api/users/me"
import { CustomThemeProvider } from "@lib/providers/custom-theme-provider"
import { ThemeProvider } from "@lib/providers/theme-provider"
import { getSEOTags, renderSchemaTags } from "@lib/seo"
import { isMembershipGroup } from "@lib/utils/membership-group"
import type { CustomerGroupRef } from "@lib/utils/membership-group"
import { Metadata } from "next"
import { OverlayProvider } from "overlay-kit"
import { Toaster } from "sonner"

export const metadata: Metadata = getSEOTags({
  title: {
    default: "아몬드영 | 미용재료 MRO 쇼핑몰",
    template: "%s | 아몬드영",
  },
  description: "미용 전문가를 위한 최저가 쇼핑몰",
  openGraph: {
    title: "아몬드영 | 미용재료 MRO 쇼핑몰",
    description: "미용 전문가를 위한 최저가 쇼핑몰",
  },
  extraTags: {
    icons: {
      icon: "/favicon.ico",
    },
  },
})

async function getMembershipStatus({
  isLoggedIn,
  customerGroupsFromCart,
  customerGroupsFromCustomer,
}: {
  isLoggedIn: boolean
  customerGroupsFromCart?: { id?: string | null }[] | null
  customerGroupsFromCustomer?: { id?: string | null }[] | null
}): Promise<MembershipContextType> {
  if (!isLoggedIn) {
    return { status: "guest", isMembershipPricing: false }
  }

  const isMembershipPricing =
    isMembershipGroup(customerGroupsFromCart) ||
    isMembershipGroup(customerGroupsFromCustomer)
  const status = isMembershipPricing ? "membership" : "regular"

  try {
    const subscription = await getCurrentSubscription().catch(() => null)
    if (subscription?.status === "ACTIVE" && subscription?.tier) {
      return {
        status,
        isMembershipPricing,
        tier: {
          code: subscription.tier.code,
          name: subscription.tier.name,
          priorityLevel: subscription.tier.priorityLevel,
        },
      }
    }
    return { status, isMembershipPricing }
  } catch {
    return { status, isMembershipPricing }
  }
}

export default async function RootLayout(props: { children: React.ReactNode }) {
  const [user, cart, customer] = await Promise.all([
    fetchMe().catch(() => null),
    retrieveCart(undefined, undefined, "no-store").catch(() => null),
    retrieveCustomer().catch(() => null),
  ])
  const cartWithCustomer = cart as
    | (typeof cart & {
        customer_id?: string | null
        customer?: { groups?: CustomerGroupRef[] }
      })
    | null

  const membershipStatus = await getMembershipStatus({
    isLoggedIn: !!user,
    customerGroupsFromCart: cartWithCustomer?.customer?.groups,
    customerGroupsFromCustomer: customer?.groups,
  })

  return (
    <html lang="ko" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className="overflow-x-clip [scrollbar-gutter:stable_both-edges]"
      >
        <OverlayProvider>
          <UserProvider initialUser={user}>
            <WishlistProvider>
              <CartProvider initialCart={cart}>
                <MembershipProvider initialMembership={membershipStatus}>
                  <ThemeProvider
                    attribute="class"
                    defaultTheme="light"
                    enableSystem={false}
                    disableTransitionOnChange
                  >
                    <CustomThemeProvider>
                      <div className="relative">
                        {props.children}

                        <FloatingButtons />
                      </div>
                      <Toaster />
                    </CustomThemeProvider>
                  </ThemeProvider>
                  <BottomNavigation />
                </MembershipProvider>
              </CartProvider>
            </WishlistProvider>
          </UserProvider>
          <Footer />
          {renderSchemaTags()}
        </OverlayProvider>
      </body>
    </html>
  )
}
