import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Bell, Check, RefreshCw, X } from 'lucide-react'
import { Browser } from '@capacitor/browser'
import { api, type Inbox } from '../lib/api'
import { isNativeApp } from '../lib/nativeSession'
import './inbox-notifications.css'

type Role = 'owner' | 'client'

function dateTime(value: string) {
  const date = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? new Date(`${value.replace(' ', 'T')}Z`) : new Date(value)
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date)
}

function showDeviceNotice(id: string, urgent = false) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  try { new Notification(urgent ? 'Responder urgente na Nayla' : 'Novo aviso na Nayla', {
    body: urgent ? 'Uma cliente alterou ou cancelou um agendamento. Abra o app para responder.'
      : 'Abra o app para ver os detalhes da sua agenda.', tag: id,
  }) } catch { /* browser may grant permission but block this surface */ }
}

function clientWhatsAppUrl(phone: string | null | undefined) {
  const digits = (phone || '').replace(/\D/g, '')
  const withCountryCode = /^\d{10,11}$/.test(digits) ? `55${digits}` : digits
  return /^55\d{10,11}$/.test(withCountryCode)
    ? `https://wa.me/${withCountryCode}` : null
}

function useInbox(role: Role, onUnread?: (count: number) => void) {
  const [data, setData] = useState<Inbox>({ unread: 0, items: [] })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const started = useRef(false)
  const previousIds = useRef(new Set<string>())
  const requestSequence = useRef(0)
  const fetchInbox = useCallback(async () => {
    const sequence = ++requestSequence.current
    try {
      const next = role === 'owner' ? await api.ownerInbox() : await api.clientInbox()
      if (sequence !== requestSequence.current) return
      if (role === 'client' && started.current) {
        for (const item of next.items) {
          if (!item.readAt && !previousIds.current.has(item.id))
            showDeviceNotice(item.id, item.requiresResponse)
        }
      }
      previousIds.current = new Set(next.items.map(item => item.id))
      started.current = true
      setData(next)
      onUnread?.(next.unread)
      setError('')
    } catch (reason) {
      if (sequence === requestSequence.current)
        setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os avisos.')
    } finally { if (sequence === requestSequence.current) setLoading(false) }
  }, [role, onUnread])
  useEffect(() => {
    void fetchInbox()
    const tick = () => { void fetchInbox() }
    const timer = window.setInterval(tick, 20_000)
    window.addEventListener('focus', tick)
    return () => { ++requestSequence.current; window.clearInterval(timer);
      window.removeEventListener('focus', tick) }
  }, [fetchInbox])
  const markRead = async (notificationId: string) => {
    try {
      if (role === 'owner') await api.readOwnerInbox(notificationId)
      else await api.readClientInbox(notificationId)
      ++requestSequence.current
      setData(current => {
        const unread = Math.max(0, current.unread -
          Number(current.items.some(item => item.id === notificationId && !item.readAt)))
        onUnread?.(unread)
        return { unread, items: current.items.map(item => item.id === notificationId
          ? { ...item, readAt: new Date().toISOString() } : item) }
      })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível marcar como lido.')
    }
  }
  return { data, error, loading, refresh: fetchInbox, markRead }
}

function Items({ role, onUnread }: { role: Role; onUnread?: (count: number) => void }) {
  const { data, error, loading, refresh, markRead } = useInbox(role, onUnread)
  const [permission, setPermission] = useState(() =>
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)
  const enableDevice = async () => {
    if (typeof Notification === 'undefined') return
    const result = await Notification.requestPermission()
    setPermission(result)
  }
  return <>
    <div className="inbox-head"><div><strong>Avisos</strong><small>{data.unread
      ? `${data.unread} ${data.unread === 1 ? 'não lido' : 'não lidos'}` : 'Tudo em dia'}</small></div>
      <button type="button" className="inbox-icon-button" onClick={() => void refresh()}
        aria-label="Atualizar avisos" title="Atualizar avisos"><RefreshCw size={17}/></button></div>
    {error ? <p className="inbox-error" role="alert">{error}</p> : null}
    {loading ? <p className="inbox-empty">Carregando avisos...</p> :
      data.items.length ? <div className="inbox-list">{data.items.map(item => {
        const whatsappUrl = role === 'owner' && item.requiresResponse
          ? clientWhatsAppUrl(item.clientPhone) : null
        return <article key={item.id}
          className={`inbox-item ${item.readAt ? '' : 'unread'} ${item.requiresResponse ? 'urgent' : ''}`}>
          <div className="inbox-item-head"><div className="inbox-item-title"><strong>{item.title}</strong>
            {item.requiresResponse ? <span className="inbox-urgent-label">Responder urgente</span> : null}
          </div><time>{dateTime(item.createdAt)}</time></div>
          <p>{item.message}</p>
          <div className="inbox-item-actions">
            {whatsappUrl ? <a href={whatsappUrl} target="_blank" rel="noopener noreferrer"
              onClick={event => { if (isNativeApp) { event.preventDefault();
                void Browser.open({ url: whatsappUrl }) } }}>
              Abrir conversa no WhatsApp <ArrowUpRight size={15}/></a> :
              item.requiresResponse ? <span className="inbox-contact-missing">
                Telefone indisponível. Confira o cadastro da cliente.</span> : null}
            {!item.readAt ? <button type="button" onClick={() => void markRead(item.id)}>
              <Check size={15}/> Marcar como lido</button> : null}
          </div>
        </article>
      })}</div> : <p className="inbox-empty">Os avisos de agendamentos aparecerão aqui.</p>}
    {!isNativeApp && permission === 'default' ? <button type="button"
      className="inbox-device-button" onClick={() => void enableDevice()}>
      Ativar aviso enquanto este app estiver aberto</button> : null}
    <p className="inbox-footnote">Os lembretes ficam salvos neste espaço. Avisos do dispositivo
      dependem de permissão e do app aberto; WhatsApp exige autorização e configuração da profissional.
      {role === 'owner' ? ' Responder urgente abre o WhatsApp para você conversar com a cliente; a resposta não é enviada pela Nayla.' : ''}</p>
  </>
}

export function OwnerInboxButton() {
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState(0)
  useEffect(() => {
    let live = true
    let initialized = false
    let seen = new Set<string>()
    let sequence = 0
    const refresh = () => {
      const current = ++sequence
      void api.ownerInbox().then(value => {
        if (!live || current !== sequence) return
        if (initialized) for (const item of value.items)
          if (!item.readAt && !seen.has(item.id)) showDeviceNotice(item.id, item.requiresResponse)
        seen = new Set(value.items.map(item => item.id))
        initialized = true
        setCount(value.unread)
      }).catch(() => {})
    }
    refresh()
    const timer = window.setInterval(refresh, 20_000)
    window.addEventListener('focus', refresh)
    return () => { live = false; ++sequence; window.clearInterval(timer);
      window.removeEventListener('focus', refresh) }
  }, [])
  useEffect(() => {
    if (!open) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [open])
  return <div className="inbox-popover-anchor"><button className="icon-button inbox-bell"
    type="button" onClick={() => setOpen(value => !value)} aria-label={`Avisos, ${count} não lidos`}
    aria-expanded={open} title="Avisos"><Bell size={19}/>{count > 0 ? <span>{Math.min(count, 99)}</span> : null}</button>
    {open ? <div className="inbox-popover" role="region" aria-label="Avisos de agendamento">
      <button className="inbox-close" type="button" aria-label="Fechar avisos"
        onClick={() => setOpen(false)}><X size={17}/></button>
      <Items role="owner" onUnread={setCount}/></div> : null}</div>
}

export function ClientInboxPanel() {
  return <section className="client-inbox-panel" aria-label="Seus avisos"><Items role="client"/></section>
}
