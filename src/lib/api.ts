import { clearNativeSession, isNativeApp, nativeSessionToken, saveNativeSession, type SessionRole } from './nativeSession'

export type Specialty = 'unhas' | 'sobrancelhas' | 'cilios'
export type ServiceCategory = Specialty | 'outros'

export type Business = {
  id: string
  name: string
  slug: string
  ownerName?: string
  specialties: Specialty[]
  description?: string | null
  phone?: string | null
  address?: string | null
  logoUrl?: string | null
  openingTime?: string | null
  closingTime?: string | null
  workingDays?: number[]
  bookingNotice?: string | null
  startTime?: string | null
  endTime?: string | null
  workdays?: number[]
  slotInterval?: number
}
export type User = { id: string; name: string; email: string; role: 'owner' }
export type Session = { user: User; business: Business }

export type Service = {
  id: string
  name: string
  category: ServiceCategory
  description?: string | null
  price: number
  durationMinutes: number
  active: boolean
}

export type Client = {
  id: string
  name: string
  cpf?: string
  phone: string
  email?: string | null
  visits: number
  lastVisit?: string | null
  totalSpent: number
  notes?: string | null
  tags?: string[]
  whatsappOptIn?: boolean
}

export type AppointmentStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'
export type Appointment = {
  id: string
  startsAt: string
  endsAt?: string
  status: AppointmentStatus
  clientId?: string
  clientName: string
  clientPhone?: string
  serviceId?: string
  serviceName: string
  price: number
  notes?: string | null
  notificationStatus?: NotificationStatus
}

export type Dashboard = {
  revenue: number
  ticketAverage: number
  appointments: number
  clients: number
  topClients: Array<{ id: string; name: string; visits: number; spent: number }>
  recentAppointments: Appointment[]
  revenueByDay?: Array<{ date: string; amount: number }>
}

export type FinancialEntry = { id: string; type: 'income' | 'expense'; description: string; amount: number; date: string; appointmentId?: string | null; createdAt?: string }
export type Finance = { entries: FinancialEntry[]; income: number; expenses: number; balance: number }

export type PublicBusiness = { business: Business; services: Service[] }
export type ClientSession = { client: Pick<Client, 'id' | 'name' | 'cpf' | 'phone' | 'email' | 'whatsappOptIn'> }
export type NotificationStatus = 'pending' | 'opted_out' | 'simulated' | 'not_configured' | 'accepted' | 'sent' | 'delivered' | 'read' | 'failed'
export type WhatsAppConfig = {
  mode: 'simulate' | 'meta' | 'disabled'
  configured: boolean
  templateName: string | null
  sender: string | null
  phoneNumberId: string | null
  hasAccessToken: boolean
  hasAppSecret: boolean
  webhookConfigured: boolean
  webhookUrl: string
  webhookVerifyToken: string
}
export type WhatsAppConfigUpdate = {
  mode: WhatsAppConfig['mode']
  templateName: string
  sender: string
  phoneNumberId: string
  accessToken?: string
  appSecret?: string
}
export type Notification = {
  id: string
  appointmentId: string
  recipient: string
  message: string
  status: NotificationStatus
  providerMessageId: string | null
  error: string | null
  createdAt: string
  updatedAt: string
  canContact?: boolean
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const apiOrigin = isNativeApp ? import.meta.env.VITE_API_ORIGIN?.trim() : ''
  if (isNativeApp && (!apiOrigin || !/^https?:\/\/[^/]+$/.test(apiOrigin)))
    throw new ApiError('O app precisa do endereço público da API para funcionar.', 0)
  const role: SessionRole = path.startsWith('/api/client/') || path.startsWith('/api/public/') ? 'client' : 'owner'
  const token = await nativeSessionToken(role)
  let response: Response
  try {
    response = await fetch(`${apiOrigin || ''}${path}`, {
      credentials: isNativeApp ? 'omit' : 'include',
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(isNativeApp ? { 'X-Nayla-App': 'mobile', ...(token ? { Authorization: `Bearer ${token}` } : {}) } : {}),
        ...options.headers,
      },
    })
  } catch {
    throw new ApiError('Não foi possível conectar. Confira sua internet e tente novamente.', 0)
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string; message?: string }
    throw new ApiError(payload.error || payload.message || 'Não foi possível concluir a solicitação.', response.status)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

async function requestSession<T>(role: SessionRole, path: string, options: RequestInit): Promise<T> {
  const result = await request<T & { sessionToken?: string }>(path, options)
  if (isNativeApp) await saveNativeSession(role, result.sessionToken)
  return result
}

async function logoutSession(role: SessionRole, path: string) {
  try { await request<void>(path, { method: 'POST' }) }
  finally { await clearNativeSession(role) }
}

const json = (value: unknown) => JSON.stringify(value)
const query = (values: Record<string, string>) => new URLSearchParams(values).toString()

export const api = {
  register: (data: { ownerName: string; businessName: string; slug: string; email: string; password: string; specialties: Specialty[] }) =>
    requestSession<Session>('owner', '/api/auth/register', { method: 'POST', body: json(data) }),
  login: (email: string, password: string) =>
    requestSession<Session>('owner', '/api/auth/login', { method: 'POST', body: json({ email, password }) }),
  me: () => request<Session>('/api/auth/me'),
  logout: () => logoutSession('owner', '/api/auth/logout'),
  deleteOwnerAccount: async (password: string) => {
    await request<void>('/api/auth/account', { method: 'DELETE', body: JSON.stringify({ password }) })
    await clearNativeSession('owner')
  },
  dashboard: (period: number) => request<Dashboard>(`/api/dashboard?period=${period}`),
  appointments: (from: string, to: string) => request<Appointment[]>(`/api/appointments?${query({ from, to })}`),
  updateAppointment: (id: string, status: AppointmentStatus) =>
    request<Appointment>(`/api/appointments/${encodeURIComponent(id)}`, { method: 'PATCH', body: json({ status }) }),
  createAppointment: (data: { clientId: string; serviceId: string; date: string; time: string; notes?: string; whatsappOptIn?: boolean }) =>
    request<Appointment>('/api/appointments', { method: 'POST', body: json(data) }),
  clients: () => request<Client[]>('/api/clients'),
  createClient: (data: { name: string; cpf: string; phone: string; email?: string; notes?: string; tags?: string[] }) =>
    request<Client & { temporaryPassword?: string }>('/api/clients', { method: 'POST', body: json(data) }),
  updateClient: (id: string, data: { name?: string; phone?: string; email?: string; notes?: string; tags?: string[] }) =>
    request<Client>(`/api/clients/${encodeURIComponent(id)}`, { method: 'PATCH', body: json(data) }),
  finance: (period: number) => request<Finance>(`/api/finance?period=${period}`),
  createFinancialEntry: (data: { type: 'income' | 'expense'; description: string; amount: number; date: string }) =>
    request<FinancialEntry>('/api/finance', { method: 'POST', body: json(data) }),
  deleteFinancialEntry: (id: string) => request<void>(`/api/finance/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  services: () => request<Service[]>('/api/services'),
  createService: (data: Omit<Service, 'id'>) => request<Service>('/api/services', { method: 'POST', body: json(data) }),
  updateService: (id: string, data: Partial<Omit<Service, 'id'>>) =>
    request<Service>(`/api/services/${encodeURIComponent(id)}`, { method: 'PATCH', body: json(data) }),
  deleteService: (id: string) => request<void>(`/api/services/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  updateBusiness: (data: Partial<Business>) => request<Business>('/api/business', { method: 'PATCH', body: json(data) }),
  assistant: (message: string) => request<{ answer: string }>('/api/assistant', { method: 'POST', body: json({ message }) }),
  whatsappConfig: () => request<WhatsAppConfig>('/api/notifications/config'),
  updateWhatsappConfig: (data: WhatsAppConfigUpdate) =>
    request<WhatsAppConfig>('/api/notifications/config', { method: 'PATCH', body: json(data) }),
  notifications: () => request<Notification[]>('/api/notifications?limit=50'),
  publicBusiness: (slug: string) => request<PublicBusiness>(`/api/public/${encodeURIComponent(slug)}`),
  availability: (slug: string, serviceId: string, date: string) =>
    request<{ slots: string[] }>(`/api/public/${encodeURIComponent(slug)}/availability?${query({ serviceId, date })}`),
  book: (slug: string, data: { serviceId: string; date: string; time: string; client: { name: string; cpf: string; phone: string; email?: string; password?: string; whatsappOptIn: boolean } }) =>
    requestSession<{ appointment: Appointment; notificationStatus: NotificationStatus }>('client', `/api/public/${encodeURIComponent(slug)}/bookings`, { method: 'POST', body: json(data) }),
  clientLogin: (slug: string, cpf: string, password: string) =>
    requestSession<ClientSession>('client', '/api/client/login', { method: 'POST', body: json({ slug, identifier: cpf, password }) }),
  clientMe: (slug: string) => request<ClientSession>(`/api/public/${encodeURIComponent(slug)}/me`),
  updateClientPreferences: (slug: string, whatsappOptIn: boolean) =>
    request<ClientSession>(`/api/public/${encodeURIComponent(slug)}/preferences`, { method: 'PATCH', body: json({ whatsappOptIn }) }),
  clientAppointments: (slug: string) => request<Appointment[]>(`/api/public/${encodeURIComponent(slug)}/appointments`),
  clientLogout: (slug: string) => logoutSession('client', `/api/public/${encodeURIComponent(slug)}/logout`),
  deleteClientAccount: async (password: string) => {
    await request<void>('/api/client/account', { method: 'DELETE', body: JSON.stringify({ password }) })
    await clearNativeSession('client')
  },
  cancelClientAppointment: (_slug: string, id: string) =>
    request<Appointment>(`/api/client/appointments/${encodeURIComponent(id)}/cancel`, { method: 'PATCH' }),
}
