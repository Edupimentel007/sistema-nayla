import { clearNativeSession, isNativeApp, nativeInstallationId, nativeSessionToken, saveNativeSession, type SessionRole } from './nativeSession'

export type Specialty = 'unhas' | 'sobrancelhas' | 'cilios' | 'cabelos' | 'terapia_capilar'
  | 'maquiagem' | 'depilacao' | 'estetica_facial' | 'estetica_corporal' | 'massagens'
  | 'micropigmentacao' | 'bronzeamento' | 'podologia' | 'outros'
export type ServiceCategory = Specialty

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
export type AssistantHistoryItem = { role: 'user' | 'assistant'; text: string }
export type AssistantReply = {
  answer: string; mode: 'ai' | 'instant' | 'local' | 'timeout'; conversationId: string
  userMessageId: string; assistantMessageId: string
}
export type AssistantStatus = { aiAvailable: boolean; provider: 'ollama' | 'groq'; model: string; reason?: string }
export type AssistantConversation = {
  id: string; title: string; createdAt: string; updatedAt: string
  messageCount: number; preview: string
}
export type AssistantStoredMessage = AssistantHistoryItem & { id: string; createdAt: string }
export type AssistantConversationDetail = {
  conversation: Pick<AssistantConversation, 'id' | 'title' | 'createdAt' | 'updatedAt'>
  messages: AssistantStoredMessage[]
}
export type AssistantActionKind = 'reschedule-request' | 'cancel-by-owner'
export type AssistantActionPreparation = {
  answer: string; conversationId: string; userMessageId: string; assistantMessageId: string
}

export type BillingPlan = 'monthly' | 'annual'
export type BillingMethod = 'card' | 'pix'
export type Subscription = {
  manualAccessStatus?: 'pending' | 'trial' | 'active' | 'expired' | 'blocked'
  accessEndsAt?: string | null
  plan: BillingPlan | null
  status: 'active' | 'pending' | 'none' | 'past_due' | 'canceled' | 'trial' | 'expired' | 'blocked'
  onboardingCompleted: boolean
  providerConfigured: boolean
  trialEndsAt: string | null
  trialDaysRemaining: number
  trialRequiresCard: boolean
  trialAvailable: boolean
  accessGranted: boolean
  checkoutUrl?: string
  currentPeriodEnd?: string
  billingMethod?: BillingMethod | null
  recurringStatus?: 'initiating' | 'pending' | 'authorized' | 'paused' | 'canceled' | 'completed' | null
  canCancelRecurring?: boolean
  autoRenews?: boolean
  annualInstallmentsPaid?: number | null
  verificationDelayed?: boolean
}
export type ProfessionalAccess = {
  businessId: string
  businessName: string
  slug: string
  ownerId: string
  ownerName: string
  email: string
  phone: string
  specialties: Specialty[]
  createdAt: string
  manualAccessStatus: 'pending' | 'trial' | 'active' | 'expired' | 'blocked'
  accessEndsAt: string | null
  trialStartedAt: string | null
  trialEndsAt: string | null
  googleConnected: boolean
}
export type ProfessionalsPage = { items: ProfessionalAccess[]; total: number; page: number; pageSize: number }
export type AccessAuditItem = {
  action: string
  previousState: string
  newState: string
  previousEndsAt: number | null
  newEndsAt: number | null
  reason: string | null
  createdAt: string
}

export type Service = {
  id: string
  name: string
  category: ServiceCategory
  description?: string | null
  price: number
  durationMinutes: number
  active: boolean
}
export type CatalogService = { id: string; name: string; category: Specialty; durationMinutes: number; price: number }
export type CustomSignupService = { name: string; category: Specialty; price: number; durationMinutes: number }

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

export type OwnerActionExpectation = { expectedDate: string; expectedTime: string; expectedServiceId: string }

export type Dashboard = {
  revenue: number
  ticketAverage: number
  appointments: number
  clients: number
  topClients: Array<{ id: string; name: string; visits: number; spent: number }>
  recentAppointments: Appointment[]
  revenueByDay?: Array<{ date: string; amount: number }>
}

export type FinancialEntry = { id: string; type: 'income' | 'expense'; description: string; amount: number; date: string; appointmentId?: string | null; prepaidAppointmentId?: string | null; prepaidAppointmentStatus?: AppointmentStatus | null; createdAt?: string }
export type Finance = { entries: FinancialEntry[]; income: number; expenses: number; balance: number }

export type PublicBusiness = { business: Business; services: Service[] }
export type ClientSession = { client: Pick<Client, 'id' | 'name' | 'cpf' | 'phone' | 'email' | 'whatsappOptIn'> }
export type GoogleCompletion = (Session & { client?: ClientSession['client']; sessionToken?: string }) |
  { registrationRequired: boolean; passwordLinkRequired: boolean; name: string; email: string; googleTicket?: string }
export type NotificationStatus = 'pending' | 'opted_out' | 'simulated' | 'not_configured' | 'accepted' | 'sent' | 'delivered' | 'read' | 'failed'
export type WhatsAppConfig = {
  mode: 'simulate' | 'meta' | 'disabled'
  configured: boolean
  urgentConfigured: boolean
  reminderConfigured: boolean
  templateName: string | null
  urgentTemplateName: string | null
  reminderTemplateName: string | null
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
  urgentTemplateName: string
  reminderTemplateName?: string
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
export type InboxItem = {
  id: string
  appointmentId: string
  kind: string
  title: string
  message: string
  readAt: string | null
  createdAt: string
}
export type Inbox = { unread: number; items: InboxItem[] }

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
  const [token, installationId] = await Promise.all([nativeSessionToken(role), nativeInstallationId()])
  let response: Response
  try {
    response = await fetch(`${apiOrigin || ''}${path}`, {
      credentials: isNativeApp ? 'omit' : 'include',
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(isNativeApp ? { 'X-Nayla-App': 'mobile', ...(installationId ? { 'X-Nayla-Device': installationId } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) } : {}),
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
  catalog: () => request<{ services: CatalogService[] }>('/api/catalog'),
  register: (data: { ownerName: string; businessName: string; slug: string; email: string; phone: string; password: string; specialties: Specialty[]; selectedServices: string[]; customServices: CustomSignupService[]; remember?: boolean }) =>
    requestSession<Session>('owner', '/api/auth/register', { method: 'POST', body: json(data) }),
  login: (email: string, password: string, remember = false) =>
    requestSession<Session>('owner', '/api/auth/login', { method: 'POST', body: json({ email, password, remember }) }),
  googleConfig: () => request<{ enabled: boolean }>('/api/auth/google/config'),
  googleStart: (data: { role: 'owner' | 'client'; slug?: string; remember: boolean; appNonce?: string }) =>
    request<{ authorizationUrl: string }>('/api/auth/google/start', { method: 'POST', body: json(data) }),
  googleComplete: async (role: SessionRole, ticket: string, appNonce?: string) => {
    const result = await request<GoogleCompletion>('/api/auth/google/complete', {
      method: 'POST', body: json({ role, ticket, appNonce }),
    })
    if (isNativeApp && 'user' in result) await saveNativeSession(role, result.sessionToken)
    return result
  },
  googleLink: (role: SessionRole, ticket: string, password: string, identifier?: string, appNonce?: string) =>
    requestSession<Session & ClientSession>(role, '/api/auth/google/link', {
      method: 'POST', body: json({ role, ticket, password, identifier, appNonce }),
    }),
  googleRegister: (role: SessionRole, ticket: string, data: Record<string, unknown>, appNonce?: string) =>
    requestSession<Session & ClientSession>(role, '/api/auth/google/register', {
      method: 'POST', body: json({ role, ticket, appNonce, ...data }),
    }),
  me: () => request<Session>('/api/auth/me'),
  adminMe: () => request<{ isSuperAdmin: boolean }>('/api/admin/me'),
  professionals: (search = '', page = 1, pageSize = 20) => request<ProfessionalsPage>(
    `/api/admin/professionals?${query({ query: search, page: String(page), pageSize: String(pageSize) })}`),
  professionalAudit: (businessId: string) => request<{ items: AccessAuditItem[] }>(
    `/api/admin/audit?${query({ businessId, page: '1', pageSize: '20' })}`),
  grantProfessional: (businessId: string, kind: 'trial' | 'paid', days = 30) => request<ProfessionalAccess>(
    `/api/admin/professionals/${encodeURIComponent(businessId)}/grant`, { method: 'POST', body: json({ kind, days }) }),
  extendProfessional: (businessId: string, days = 30) => request<ProfessionalAccess>(
    `/api/admin/professionals/${encodeURIComponent(businessId)}/extend`, { method: 'POST', body: json({ days }) }),
  revokeProfessional: (businessId: string) => request<ProfessionalAccess>(
    `/api/admin/professionals/${encodeURIComponent(businessId)}/revoke`, { method: 'POST', body: json({}) }),
  subscription: () => request<Subscription>('/api/billing/subscription'),
  completeOnboarding: () => request<{ onboardingCompleted: boolean }>('/api/billing/onboarding', {
    method: 'PATCH', body: json({ completed: true }),
  }),
  logout: () => logoutSession('owner', '/api/auth/logout'),
  changeOwnerPassword: async (currentPassword: string, newPassword: string) => {
    await request<void>('/api/auth/change-password', {
      method: 'POST', body: json({ currentPassword, newPassword }),
    })
    await clearNativeSession('owner')
  },
  deleteOwnerAccount: async (password: string) => {
    await request<void>('/api/auth/account', { method: 'DELETE', body: JSON.stringify({ password }) })
    await clearNativeSession('owner')
  },
  dashboard: (period: number) => request<Dashboard>(`/api/dashboard?period=${period}`),
  appointmentsToday: () => request<{ date: string; appointments: Appointment[] }>('/api/appointments/today'),
  appointments: (from: string, to: string) => request<Appointment[]>(`/api/appointments?${query({ from, to })}`),
  updateAppointment: (id: string, status: AppointmentStatus) =>
    request<Appointment>(`/api/appointments/${encodeURIComponent(id)}`, { method: 'PATCH', body: json({ status }) }),
  requestOwnerReschedule: (id: string, expected: OwnerActionExpectation, reason?: string) =>
    request<Appointment & { notificationStatus: NotificationStatus; eventId: string }>(`/api/appointments/${encodeURIComponent(id)}/reschedule-request`, { method: 'PATCH', body: json({ ...expected, reason: reason?.trim() || undefined }) }),
  cancelOwnerAppointment: (id: string, expected: OwnerActionExpectation, reason?: string) =>
    request<Appointment & { notificationStatus: NotificationStatus; eventId: string }>(`/api/appointments/${encodeURIComponent(id)}/cancel-by-owner`, { method: 'PATCH', body: json({ ...expected, reason: reason?.trim() || undefined }) }),
  createAppointment: (data: { clientId: string; serviceId: string; date: string; time: string; notes?: string; whatsappOptIn?: boolean }) =>
    request<Appointment>('/api/appointments', { method: 'POST', body: json(data) }),
  clients: () => request<Client[]>('/api/clients'),
  createClient: (data: { name: string; cpf: string; phone: string; email?: string; notes?: string; tags?: string[] }) =>
    request<Client & { temporaryPassword?: string }>('/api/clients', { method: 'POST', body: json(data) }),
  updateClient: (id: string, data: { name?: string; phone?: string; email?: string; notes?: string; tags?: string[] }) =>
    request<Client>(`/api/clients/${encodeURIComponent(id)}`, { method: 'PATCH', body: json(data) }),
  finance: (period: number) => request<Finance>(`/api/finance?period=${period}`),
  financeRange: (from: string, to: string) => request<Finance>(`/api/finance?${query({ from, to })}`),
  createFinancialEntry: (data: { type: 'income' | 'expense'; description: string; amount: number; date: string; appointmentId?: string }) =>
    request<FinancialEntry>('/api/finance', { method: 'POST', body: json(data) }),
  deleteFinancialEntry: (id: string) => request<void>(`/api/finance/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  services: () => request<Service[]>('/api/services'),
  createService: (data: Omit<Service, 'id'>) => request<Service>('/api/services', { method: 'POST', body: json(data) }),
  updateService: (id: string, data: Partial<Omit<Service, 'id'>>) =>
    request<Service>(`/api/services/${encodeURIComponent(id)}`, { method: 'PATCH', body: json(data) }),
  deleteService: (id: string) => request<void>(`/api/services/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  updateBusiness: (data: Partial<Business>) => request<Business>('/api/business', { method: 'PATCH', body: json(data) }),
  assistantStatus: () => request<AssistantStatus>('/api/assistant/status'),
  assistantConversations: (offset = 0) =>
    request<{ conversations: AssistantConversation[] }>(`/api/assistant/conversations?limit=100&offset=${offset}`),
  assistantConversation: (id: string) =>
    request<AssistantConversationDetail>(`/api/assistant/conversations/${encodeURIComponent(id)}`),
  deleteAssistantConversation: (id: string) =>
    request<void>(`/api/assistant/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  assistant: (message: string, conversationId?: string) =>
    request<AssistantReply>('/api/assistant', { method: 'POST', body: json({ message, conversationId }) }),
  prepareAssistantAction: (message: string, kind: AssistantActionKind, conversationId?: string) =>
    request<AssistantActionPreparation>('/api/assistant/action-preparation', {
      method: 'POST', body: json({ message, kind, conversationId }),
    }),
  recordAssistantActionResult: (conversationId: string, eventId: string) =>
    request<{ answer: string; assistantMessageId: string }>(
      `/api/assistant/conversations/${encodeURIComponent(conversationId)}/action-result`,
      { method: 'POST', body: json({ eventId }) }),
  whatsappConfig: () => request<WhatsAppConfig>('/api/notifications/config'),
  updateWhatsappConfig: (data: WhatsAppConfigUpdate) =>
    request<WhatsAppConfig>('/api/notifications/config', { method: 'PATCH', body: json(data) }),
  notifications: () => request<Notification[]>('/api/notifications?limit=50'),
  ownerInbox: () => request<Inbox>('/api/inbox'),
  readOwnerInbox: (id: string) => request<void>(`/api/inbox/${encodeURIComponent(id)}/read`, { method: 'PATCH' }),
  clientInbox: () => request<Inbox>('/api/client/inbox'),
  readClientInbox: (id: string) => request<void>(`/api/client/inbox/${encodeURIComponent(id)}/read`, { method: 'PATCH' }),
  publicBusiness: (slug: string) => request<PublicBusiness>(`/api/public/${encodeURIComponent(slug)}`),
  availability: (slug: string, serviceId: string, date: string) =>
    request<{ slots: string[] }>(`/api/public/${encodeURIComponent(slug)}/availability?${query({ serviceId, date })}`),
  book: (slug: string, data: { serviceId: string; date: string; time: string; remember?: boolean; client: { name: string; cpf: string; phone: string; email?: string; password?: string; whatsappOptIn: boolean } }) =>
    requestSession<{ appointment: Appointment; notificationStatus: NotificationStatus }>('client', `/api/public/${encodeURIComponent(slug)}/bookings`, { method: 'POST', body: json(data) }),
  clientLogin: (slug: string, cpf: string, password: string, remember = false) =>
    requestSession<ClientSession>('client', '/api/client/login', { method: 'POST', body: json({ slug, identifier: cpf, password, remember }) }),
  clientMe: (slug: string) => request<ClientSession>(`/api/public/${encodeURIComponent(slug)}/me`),
  updateClientPreferences: (slug: string, whatsappOptIn: boolean) =>
    request<ClientSession>(`/api/public/${encodeURIComponent(slug)}/preferences`, { method: 'PATCH', body: json({ whatsappOptIn }) }),
  clientAppointments: (slug: string) => request<Appointment[]>(`/api/public/${encodeURIComponent(slug)}/appointments`),
  clientAvailability: (slug: string, serviceId: string, date: string, excludeAppointmentId: string) =>
    request<{ slots: string[] }>(`/api/public/${encodeURIComponent(slug)}/availability?${query({ serviceId, date, excludeAppointmentId })}`),
  updateClientAppointment: (id: string, data: { serviceId: string; date: string; time: string }) =>
    request<Appointment & { notificationStatus: NotificationStatus }>(`/api/client/appointments/${encodeURIComponent(id)}`, { method: 'PATCH', body: json(data) }),
  clientLogout: (slug: string) => logoutSession('client', `/api/public/${encodeURIComponent(slug)}/logout`),
  deleteClientAccount: async (password: string) => {
    await request<void>('/api/client/account', { method: 'DELETE', body: JSON.stringify({ password }) })
    await clearNativeSession('client')
  },
  cancelClientAppointment: (_slug: string, id: string, reason?: string) =>
    request<Appointment & { notificationStatus: NotificationStatus }>(`/api/client/appointments/${encodeURIComponent(id)}/cancel`, { method: 'PATCH', body: json({ reason: reason?.trim() || undefined }) }),
}
