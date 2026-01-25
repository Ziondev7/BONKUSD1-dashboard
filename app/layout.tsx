import type { Metadata, Viewport } from "next"
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google"
import "./globals.css"

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
})

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
})

export const metadata: Metadata = {
  title: "BONKUSD1 | USD1 Token Dashboard",
  description: "Track every new token launched on Bonk.fun paired with USD1 stablecoin. Real-time prices, volume, and market data.",
  keywords: ["Solana", "USD1", "Bonk", "DeFi", "Trading", "Crypto", "Dashboard"],
  authors: [{ name: "BONKUSD1" }],
  openGraph: {
    title: "BONKUSD1 | USD1 Token Dashboard",
    description: "Track USD1 pairs on Bonk.fun - Real-time prices, volume, and market data",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "BONKUSD1 | USD1 Token Dashboard",
    description: "Track USD1 pairs on Bonk.fun - Real-time prices, volume, and market data",
    creator: "@BONKUSD1",
  },
  icons: {
    icon: "/icon.svg",
    apple: "/apple-icon.png",
  },
    generator: 'v0.app'
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#030303",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} ${spaceGrotesk.variable} dark`}
      suppressHydrationWarning
    >
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className="font-sans antialiased bg-[#0F0B18] text-white min-h-screen">
        {children}
      </body>
    </html>
  )
}
