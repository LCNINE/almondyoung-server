import Footer from "@/components/layout/footer"
import { BottomNavigation } from "@/components/layout/nav/bottom-nav"
import { ObservabilityProvider } from "@/components/providers/observability-provider"
import { FloatingButtons } from "@/components/shared/custom-buttons/floating-buttons"
import { PushNotificationProvider } from "@/components/providers/push-notification-provider"
import { CartProvider } from "@/contexts/cart-context"
import { UserProvider } from "@/contexts/user-context"
import { getMyProfile } from "@/lib/api/users/profile"
import "@/styles/globals.css"
import { retrieveCart } from "@lib/api/medusa/cart"
import { CustomThemeProvider } from "@lib/providers/custom-theme-provider"
import { QueryProvider } from "@lib/providers/query-provider"
import { ThemeProvider } from "@lib/providers/theme-provider"
import { getSEOTags, renderSchemaTags } from "@lib/seo"
import { Metadata, Viewport } from "next"
import { NextIntlClientProvider } from "next-intl"
import { getLocale, getMessages } from "next-intl/server"
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
    manifest: "/site.webmanifest",
  },
})

// viewport-fit=cover: fixed bottom-0 요소가 홈 인디케이터 영역까지 덮도록 +
// env(safe-area-inset-*) 값이 실제로 채워지도록 함
export const viewport: Viewport = {
  viewportFit: "cover",
}

export default async function RootLayout(props: { children: React.ReactNode }) {
  const [userDetailInfo, cart, locale, messages] = await Promise.all([
    getMyProfile().catch(() => null),
    retrieveCart(undefined, undefined, "no-store").catch(() => null),
    getLocale(),
    getMessages(),
  ])

  return (
    <html lang={locale} suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className="overflow-x-clip [scrollbar-gutter:stable_both-edges]"
      >
        <NextIntlClientProvider locale={locale} messages={messages}>
          <QueryProvider>
            <OverlayProvider>
              <UserProvider initialUser={userDetailInfo}>
                <ObservabilityProvider />
                <PushNotificationProvider />
                <CartProvider initialCart={cart}>
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
                </CartProvider>
              </UserProvider>
              <Footer />
              {renderSchemaTags()}
            </OverlayProvider>
          </QueryProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
