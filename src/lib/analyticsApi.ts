import { isNativeApp, nativeSessionToken } from './nativeSession'

export type AnalyticsPeriod = 7 | 30 | 60 | 90
export type Comparison = { current: number; previous: number; changePercent: number | null }
export type Analytics = {
  period: { days: AnalyticsPeriod; from: string; to: string; previousFrom: string; previousTo: string }
  overview: {
    income: Comparison; expenses: Comparison; balance: Comparison; ticketAverage: Comparison
    completed: Comparison; bookings: number; clientsServed: number
    cancellationRate: number | null; noShowRate: number | null
  }
  clients: {
    new: number; returning: number
    retention: { eligible: number; returned: number; rate: number | null }
    averageVisits: number | null
    frequency: { one: number; two: number; threePlus: number }
    inactiveCount: number
    inactive: Array<{ id: string; name: string; lastVisit: string; daysSince: number; visits: number }>
    top: Array<{ id: string; name: string; visits: number; completedValue: number }>
  }
  appointments: {
    statuses: { pending: number; confirmed: number; completed: number; cancelled: number; noShow: number }
    cancellationRate: number | null; noShowRate: number | null; denominator: number
    weekday: Array<{ day: number; bookings: number; completed: number; cancelled: number; noShow: number }>
  }
  services: Array<{
    id: string; name: string; category: string; bookings: number; completed: number
    cancelled: number; noShow: number; completedValue: number; ticketAverage: number
    valueSharePercent: number
  }>
  series: Array<{
    date: string; income: number; expenses: number; balance: number
    bookings: number; completed: number; ticketAverage: number | null
  }>
  insights: Array<{ category: string; title: string; explanation: string; tip: string }>
  definitions: { revenue: string; ticket: string; retention: string; rates: string; newClients: string }
}

export async function getAnalytics(period: AnalyticsPeriod): Promise<Analytics> {
  const apiOrigin = isNativeApp ? import.meta.env.VITE_API_ORIGIN?.trim() : ''
  if (isNativeApp && (!apiOrigin || !/^https?:\/\/[^/]+$/.test(apiOrigin)))
    throw new Error('Configure o endereço público da API para usar as análises no app.')
  const token = await nativeSessionToken('owner')
  let response: Response
  try {
    response = await fetch(`${apiOrigin || ''}/api/analytics?period=${period}`, {
      credentials: isNativeApp ? 'omit' : 'include',
      headers: isNativeApp
        ? { 'X-Nayla-App': 'mobile', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
        : undefined,
    })
  } catch {
    throw new Error('Não foi possível carregar as análises. Confira sua conexão e tente novamente.')
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(payload.error || 'Não foi possível carregar as análises.')
  }
  return response.json() as Promise<Analytics>
}
