import { BonkDashboard } from "@/components/bonk-dashboard"

// Fetch initial token data on the server for instant loading
async function getInitialTokens() {
  try {
    // Use environment variable or default to production URL
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXT_PUBLIC_BASE_URL || "https://bonkusd1.fun"

    const res = await fetch(`${baseUrl}/api/tokens-v2`, {
      next: { revalidate: 30 }, // Cache for 30 seconds on the server
      headers: {
        'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=300',
      }
    })

    if (!res.ok) return null

    const data = await res.json()
    return data.tokens || null
  } catch (error) {
    // Silent fail - client will fetch data anyway
    return null
  }
}

export default async function Home() {
  const initialTokens = await getInitialTokens()

  return <BonkDashboard initialTokens={initialTokens} />
}

// Enable ISR - revalidate page every 30 seconds
export const revalidate = 30

// Force dynamic rendering to always get fresh data
export const dynamic = "force-dynamic"
