import type { ReactNode } from 'react'
import { AlertCircle, Inbox, LoaderCircle, Sparkles } from 'lucide-react'
import type { AppointmentStatus, ServiceCategory, Specialty } from '../lib/api'

export const money = (value: number | undefined | null) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value ?? 0)
const zonedDate = (value: string) => new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00-03:00` : value)
const brazil = { timeZone: 'America/Sao_Paulo' }
export const shortDate = (value: string) => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', ...brazil }).format(zonedDate(value))
export const fullDate = (value: string) => new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long', ...brazil }).format(zonedDate(value))
export const dateTime = (value: string) => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', ...brazil }).format(zonedDate(value))
export const time = (value: string) => new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', ...brazil }).format(zonedDate(value))
export const calendarDay = (value: string) => new Intl.DateTimeFormat('pt-BR', { day: 'numeric', ...brazil }).format(zonedDate(value))
export const calendarMonth = (value: string) => new Intl.DateTimeFormat('pt-BR', { month: 'short', ...brazil }).format(zonedDate(value))
export const localISODate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

export const specialties: Record<Specialty, string> = {
  unhas: 'Unhas', sobrancelhas: 'Sobrancelhas', cilios: 'Cílios',
  cabelos: 'Cabelos', terapia_capilar: 'Terapia capilar', maquiagem: 'Maquiagem',
  depilacao: 'Depilação', estetica_facial: 'Estética facial',
  estetica_corporal: 'Estética corporal', massagens: 'Massagens e spa',
  micropigmentacao: 'Micropigmentação', bronzeamento: 'Bronzeamento',
  podologia: 'Podologia', outros: 'Outra especialidade',
}
export const specialtyGroups: Array<{ title: string; items: Specialty[] }> = [
  { title: 'Olhar e unhas', items: ['unhas', 'sobrancelhas', 'cilios', 'micropigmentacao'] },
  { title: 'Cabelos e maquiagem', items: ['cabelos', 'terapia_capilar', 'maquiagem'] },
  { title: 'Pele, corpo e bem-estar', items: ['depilacao', 'estetica_facial', 'estetica_corporal', 'massagens', 'bronzeamento', 'podologia'] },
  { title: 'Mais opções', items: ['outros'] },
]
export const serviceCategories: Record<ServiceCategory, string> = { ...specialties, outros: 'Outros serviços' }
export const statusLabels: Record<AppointmentStatus, string> = { pending: 'Pendente', confirmed: 'Confirmado', completed: 'Concluído', cancelled: 'Cancelado', no_show: 'Não compareceu' }

export function Logo({ small = false }: { small?: boolean }) {
  return <span className={`logo ${small ? 'logo-small' : ''}`}><span className="logo-mark"><Sparkles size={small ? 18 : 22} strokeWidth={1.8} /></span><span>nayla<span className="logo-dot">.</span></span></span>
}

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`panel ${className}`}>{children}</section>
}

export function Loading({ label = 'Carregando informações...' }: { label?: string }) {
  return <div className="state-box"><LoaderCircle className="spin" size={26} /><span>{label}</span></div>
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="state-box error"><AlertCircle size={28} /><strong>Algo não saiu como esperado</strong><span>{message}</span>{onRetry ? <button className="btn btn-secondary" onClick={onRetry}>Tentar novamente</button> : null}</div>
}

export function EmptyState({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }) {
  return <div className="state-box empty"><Inbox size={30} /><strong>{title}</strong>{detail ? <span>{detail}</span> : null}{action}</div>
}

export function StatusBadge({ status }: { status: AppointmentStatus }) {
  return <span className={`status status-${status}`}>{statusLabels[status] ?? status}</span>
}

export function PageHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="page-heading"><div>{eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}<h1>{title}</h1>{description ? <p>{description}</p> : null}</div>{action ? <div className="page-action">{action}</div> : null}</div>
}

export function PeriodPicker({ value, onChange, showToday = false }: { value: number; onChange: (value: number) => void; showToday?: boolean }) {
  return <div className="period-picker" role="group" aria-label="Período">{(showToday ? [1, 7, 30, 60, 90] : [7, 30, 60, 90]).map((days) => <button key={days} type="button" className={value === days ? 'selected' : ''} aria-pressed={value === days} onClick={() => onChange(days)}>{days === 1 ? 'Hoje' : `${days} dias`}</button>)}</div>
}
