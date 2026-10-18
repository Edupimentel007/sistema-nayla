import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { ArrowUp, CalendarDays, CircleDollarSign, Heart, RotateCcw, Sparkles } from 'lucide-react'
import { api, type Appointment, type AssistantStatus, type NotificationStatus, type OwnerActionExpectation } from '../../lib/api'
import { useAuth } from '../contexts'
import { dateTime, PageHeading, Panel } from '../shared'
import './admin-updates.css'
import './admin-motion.css'
import './assistant-chat.css'

type Message = { id: string; role: 'user' | 'assistant'; text: string }
type ActionKind = 'reschedule-request' | 'cancel-by-owner'
type ActionDraft = {
  kind: ActionKind
  appointments: Appointment[]
  selectedId: string
  search: string
  reason: string
  stage: 'select' | 'confirm'
}

const prompts = [
  { icon: <CircleDollarSign size={18}/>, text: 'Quanto faturei este mês?' },
  { icon: <CalendarDays size={18}/>, text: 'Quais são os atendimentos de hoje?' },
  { icon: <Heart size={18}/>, text: 'Quais clientes não voltaram há mais de um mês?' },
  { icon: <Sparkles size={18}/>, text: 'Preciso remarcar uma cliente por imprevisto' },
  { icon: <Heart size={18}/>, text: 'Como posso aumentar o retorno das clientes da minha área?' },
  { icon: <CircleDollarSign size={18}/>, text: 'Como registro uma entrada no financeiro?' },
]

function modelStatusText(status: AssistantStatus | null) {
  if (!status) return 'Verificando a conversa livre'
  if (status.aiAvailable) return 'Conversa livre disponível'
  if (status.reason === 'model_missing') return 'Conversa livre ainda não ativada · consultas disponíveis'
  if (status.reason === 'server_offline') return 'Conversa livre temporariamente indisponível'
  if (status.reason === 'request_failed') return 'Conversa livre não respondeu · consultas disponíveis'
  return 'Chat livre indisponível · consultas do app disponíveis'
}

function saoPauloDate() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function requestedAction(message: string): ActionKind | null {
  const query = message.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (/\b(como|quem|qual|quais|quando|posso|historico)\b/.test(query) ||
    /\b(nao|nunca)\b.{0,35}\b(remarcar|reagendar|desmarcar|cancelar)\b/.test(query)) return null
  if (/\b(remarcar|reagendar|remarque|reagende|remarca|reagenda)\b/.test(query)) return 'reschedule-request'
  if (/\b(desmarcar|cancelar|desmarque|cancele|desmarca|cancela)\b/.test(query)) return 'cancel-by-owner'
  return null
}

function notificationMessage(status: NotificationStatus) {
  switch (status) {
    case 'accepted': case 'sent': return 'O WhatsApp aceitou o aviso; a entrega ainda não foi confirmada.'
    case 'delivered': return 'O aviso foi entregue pelo WhatsApp.'
    case 'read': return 'O aviso foi lido no WhatsApp.'
    case 'simulated': return 'O aviso foi registrado em modo de simulação. Nenhuma mensagem foi enviada.'
    case 'opted_out': return 'A cliente não autorizou mensagens automáticas. Nenhuma mensagem foi enviada.'
    case 'not_configured': return 'O WhatsApp ainda não está configurado para envio real. Nenhuma mensagem foi enviada.'
    case 'failed': return 'O envio automático falhou. Confira o histórico em Configurações.'
    default: return 'O aviso está em processamento. Confira o histórico em Configurações.'
  }
}

export function AssistantPage() {
  const { session } = useAuth()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [draft, setDraft] = useState<ActionDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [modelStatus, setModelStatus] = useState<AssistantStatus | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let active = true
    void api.assistantStatus().then(status => {
      if (active) setModelStatus(status)
    }).catch(() => {
      if (active) setModelStatus({ aiAvailable: false, provider: 'ollama', model: 'local' })
    })
    return () => { active = false }
  }, [])
  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    endRef.current?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' })
  }, [messages, busy, draft])

  const addAssistant = (text: string) => setMessages(current => [...current, { id: crypto.randomUUID(), role: 'assistant', text }])

  const send = async (value: string) => {
    const text = value.trim()
    if (!text || busy) return
    setInput('')
    setError('')
    setDraft(null)
    setBusy(true)
    setMessages(current => [...current, { id: crypto.randomUUID(), role: 'user', text }])
    try {
      const kind = requestedAction(text)
      if (kind) {
        const today = saoPauloDate()
        const end = new Date(`${today}T12:00:00Z`)
        end.setUTCDate(end.getUTCDate() + 180)
        const appointments = (await api.appointments(today, end.toISOString().slice(0, 10)))
          .filter(item => ['pending', 'confirmed'].includes(item.status) && Date.parse(item.startsAt) > Date.now())
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
        if (!appointments.length) addAssistant('Não encontrei agendamentos futuros ativos para alterar. Confira sua agenda ou peça à cliente para fazer um novo agendamento.')
        else {
          setDraft({ kind, appointments, selectedId: '', search: '', reason: '', stage: 'select' })
          addAssistant(kind === 'reschedule-request'
            ? 'Vou te ajudar a pedir uma remarcação. Escolha o agendamento exato; depois você poderá revisar e confirmar o aviso à cliente.'
            : 'Vou te ajudar a cancelar por imprevisto. Escolha o agendamento exato; depois você poderá revisar e confirmar o aviso à cliente.')
        }
      } else {
        const history = messages.slice(-8).map(({ role, text: previous }) => ({ role, text: previous }))
        const response = await api.assistant(text, history)
        setModelStatus(current => ({
          provider: 'ollama', model: current?.model || 'local',
          aiAvailable: response.mode === 'ai',
          ...(response.mode === 'local' ? { reason: current?.reason || 'request_failed' } : {}),
        }))
        addAssistant(response.answer)
      }
    } catch (reason) {
      setInput(text)
      setError(reason instanceof Error ? reason.message : 'Não consegui responder agora. Tente novamente.')
    } finally { setBusy(false) }
  }

  const confirmAction = async () => {
    if (!draft || busy) return
    const selected = draft.appointments.find(item => item.id === draft.selectedId)
    if (!selected?.serviceId) return
    const expected: OwnerActionExpectation = {
      expectedDate: selected.startsAt.slice(0, 10),
      expectedTime: selected.startsAt.slice(11, 16),
      expectedServiceId: selected.serviceId,
    }
    setBusy(true)
    setError('')
    try {
      const result = draft.kind === 'reschedule-request'
        ? await api.requestOwnerReschedule(selected.id, expected, draft.reason)
        : await api.cancelOwnerAppointment(selected.id, expected, draft.reason)
      setDraft(null)
      addAssistant(`${draft.kind === 'reschedule-request' ? 'Pedido de remarcação registrado' : 'Agendamento cancelado'} para ${selected.clientName} (${selected.serviceName}, ${dateTime(selected.startsAt)}). O horário antigo foi liberado. ${notificationMessage(result.notificationStatus)}`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não consegui alterar o agendamento. Confira a agenda e tente novamente.')
    } finally { setBusy(false) }
  }

  const submit = (event: FormEvent) => { event.preventDefault(); void send(input) }
  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void send(input)
    }
  }
  const clearConversation = () => {
    setMessages([])
    setDraft(null)
    setError('')
    setInput('')
  }

  return <div className="page assistant-page">
    <PageHeading eyebrow="SUA ASSISTENTE" title="Converse com a Nayla"
      description="Pergunte sobre seu espaço, suas clientes, seus resultados e sua área de atuação." />
    <Panel className="chat-panel">
      <div className="chat-top">
        <span className="chat-avatar"><Sparkles size={22}/></span>
        <div className="chat-top-info">
          <strong>Nayla</strong>
          <small role="status" aria-live="polite">
            <span className={`online-dot ${modelStatus?.aiAvailable ? '' : 'offline'}`}/>
            {modelStatusText(modelStatus)}
          </small>
        </div>
        {messages.length > 0 && <button type="button" className="chat-clear"
          onClick={clearConversation} disabled={busy} title="Começar uma conversa nova">
          <RotateCcw size={15}/> Nova conversa
        </button>}
      </div>
      <div className="chat-messages">
        {messages.length === 0
          ? <div className="chat-empty">
            <span className="chat-empty-icon"><Sparkles size={29}/></span>
            <h2>Oi, {session?.user.name.split(' ')[0]}! Como posso ajudar?</h2>
            <p>{modelStatus === null
              ? 'Escolha uma sugestão enquanto verifico a IA local.'
              : modelStatus.aiAvailable
                ? 'Converse livremente sobre seu negócio, os dados do app e as áreas de beleza do seu cadastro.'
                : 'Posso consultar os dados do app e explicar suas funções. A conversa livre está sendo preparada pela Nayla.'}</p>
            <div className="prompt-grid">
              {prompts.map(prompt => <button type="button" key={prompt.text} disabled={busy}
                onClick={() => void send(prompt.text)}>{prompt.icon}<span>{prompt.text}</span></button>)}
            </div>
          </div>
          : <div className="message-stack">
            {messages.map(message => <div className={`chat-message ${message.role}`} key={message.id}>
              {message.role === 'assistant' ? <span className="message-avatar"><Sparkles size={16}/></span> : null}
              <div>{message.text}</div>
            </div>)}
            {busy && !draft ? <div className="chat-message assistant" role="status" aria-label="Nayla está preparando a resposta">
              <span className="message-avatar"><Sparkles size={16}/></span>
              <div className="typing"><i/><i/><i/></div>
            </div> : null}
          </div>}
        {draft ? <ActionCard draft={draft} busy={busy} onChange={setDraft}
          onCancel={() => setDraft(null)} onConfirm={() => void confirmAction()} /> : null}
        <div ref={endRef}/>
      </div>
      <form className="chat-form" onSubmit={submit}>
        <div className="chat-input-wrap">
          <textarea aria-label="Mensagem para Nayla" value={input} rows={2}
            onChange={event => setInput(event.target.value)} onKeyDown={handleComposerKeyDown}
            placeholder="Pergunte sobre sua agenda, resultados ou serviços..."
            maxLength={1000} />
          <button type="submit" disabled={!input.trim() || busy} aria-label="Enviar mensagem"><ArrowUp size={20}/></button>
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <small>Enter envia · Shift+Enter quebra linha. A Nayla consulta apenas os dados do seu espaço. Alterações precisam da sua confirmação.</small>
      </form>
    </Panel>
  </div>
}

function ActionCard({ draft, busy, onChange, onCancel, onConfirm }: { draft: ActionDraft; busy: boolean; onChange: (value: ActionDraft) => void; onCancel: () => void; onConfirm: () => void }) {
  const selected = draft.appointments.find(item => item.id === draft.selectedId)
  const search = draft.search.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const visible = draft.appointments.filter(item => `${item.clientName} ${item.serviceName} ${item.clientPhone ?? ''} ${dateTime(item.startsAt)}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(search)).slice(0, 12)
  const actionLabel = draft.kind === 'reschedule-request' ? 'Pedir remarcação' : 'Cancelar por imprevisto'
  return <section className="assistant-action-card" aria-label={`${actionLabel} com a Nayla`}>
    <div className="assistant-action-heading"><span className="eyebrow">AÇÃO NA AGENDA</span><h3>{draft.stage === 'select' ? 'Escolha o agendamento' : 'Revise antes de confirmar'}</h3></div>
    {draft.stage === 'select' ? <><label className="assistant-action-search">Buscar cliente, serviço ou horário<input type="search" value={draft.search} onChange={event => onChange({ ...draft, search: event.target.value })} placeholder="Ex.: Ana ou design de sobrancelhas" /></label><div className="assistant-action-list">{visible.length ? visible.map(item => <button key={item.id} type="button" className={item.id === draft.selectedId ? 'selected' : ''} aria-pressed={item.id === draft.selectedId} onClick={() => onChange({ ...draft, selectedId: item.id })}><strong>{item.clientName}</strong><span>{item.serviceName} · {dateTime(item.startsAt)}</span>{item.clientPhone ? <small>{item.clientPhone}</small> : null}</button>) : <p>Nenhum agendamento corresponde à busca.</p>}</div>{draft.appointments.length > 12 && !draft.search ? <small>Mostrando os próximos 12. Use a busca para encontrar outros horários.</small> : null}<label className="assistant-action-reason">Motivo que será enviado à cliente (opcional)<textarea rows={2} maxLength={100} value={draft.reason} onChange={event => onChange({ ...draft, reason: event.target.value })} placeholder="Ex.: compromisso de última hora" /></label><div className="assistant-action-buttons"><button type="button" className="btn btn-secondary" onClick={onCancel}>Fechar</button><button type="button" className="btn btn-primary" disabled={!selected?.serviceId || busy} onClick={() => onChange({ ...draft, stage: 'confirm' })}>Revisar {draft.kind === 'reschedule-request' ? 'remarcação' : 'cancelamento'}</button></div></> : <><div className="assistant-action-summary"><strong>{selected?.clientName}</strong><span>{selected?.serviceName}</span><span>{selected ? dateTime(selected.startsAt) : ''}</span></div><p className="assistant-action-warning">Ao confirmar, este agendamento será cancelado e o horário ficará disponível. A Nayla registrará um aviso com até oito opções de horários do mês do atendimento, quando houver. O envio pelo WhatsApp depende do consentimento da cliente e da configuração da profissional.</p>{draft.reason ? <p className="assistant-action-note">Motivo que será enviado à cliente: {draft.reason}</p> : null}<div className="assistant-action-buttons"><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => onChange({ ...draft, stage: 'select' })}>Voltar</button><button type="button" className="btn btn-primary" disabled={busy || !selected?.serviceId} onClick={onConfirm}>{busy ? 'Confirmando...' : `${actionLabel} e avisar cliente`}</button></div></>}
  </section>
}
