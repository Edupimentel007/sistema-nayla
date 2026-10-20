import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ArrowLeft, ArrowUp, CalendarDays, CircleDollarSign, ExternalLink, Heart, History, Plus, Sparkles, Trash2 } from 'lucide-react'
import { api, type Appointment, type AssistantConversation, type AssistantStatus, type NotificationStatus, type OwnerActionExpectation } from '../../lib/api'
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
  { icon: <Sparkles size={18}/>, text: 'Como posso me destacar no meu ramo?' },
  { icon: <CircleDollarSign size={18}/>, text: 'Como registro uma entrada no financeiro?' },
]

function modelStatusText(status: AssistantStatus | null) {
  if (!status) return 'Verificando a IA local'
  if (status.aiAvailable) return 'Conversa livre disponível'
  if (status.reason === 'model_missing') return 'IA local ainda não ativada · dicas e consultas disponíveis'
  if (status.reason === 'server_offline') return 'IA local temporariamente indisponível · dicas disponíveis'
  if (status.reason === 'request_failed') return 'IA local não respondeu · dicas e consultas disponíveis'
  return 'IA local indisponível · dicas e consultas disponíveis'
}

function conversationDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(date)
}

type AnswerSource = { title: string; url: string; host: string }
const researchSourceHosts = new Set([
  'blog.rn.sebrae.com.br', 'inteligenciademercado.rj.sebrae.com.br',
  'meuatendimento.sebrae.com.br', 'support.google.com', 'www.gov.br',
])

function splitAnswerSources(text: string): { body: string; sources: AnswerSource[] } {
  const normalized = text.replace(/\r\n/g, '\n')
  const marker = '\n\nFontes consultadas:\n'
  const markerAt = normalized.lastIndexOf(marker)
  if (markerAt < 0) return { body: text, sources: [] }

  const lines = normalized.slice(markerAt + marker.length).trim().split('\n')
  const sources: AnswerSource[] = []
  for (const line of lines) {
    const match = /^-\s+(.+?)\s+\u2014\s+(https:\/\/\S+)\s*$/.exec(line)
    if (!match) return { body: text, sources: [] }
    try {
      const parsed = new URL(match[2])
      if (parsed.protocol !== 'https:' || !researchSourceHosts.has(parsed.hostname)
        || parsed.port || parsed.username || parsed.password) {
        return { body: text, sources: [] }
      }
      sources.push({ title: match[1].trim(), url: parsed.toString(), host: parsed.hostname })
    } catch { return { body: text, sources: [] } }
  }
  return sources.length
    ? { body: normalized.slice(0, markerAt).trimEnd(), sources }
    : { body: text, sources: [] }
}

function AssistantMessageContent({ text }: { text: string }) {
  const { body, sources } = splitAnswerSources(text)
  return <div className="assistant-answer">
    <div className="assistant-answer-body">{body}</div>
    {sources.length ? <section className="assistant-answer-sources" aria-label="Fontes consultadas pela Nayla">
      <strong>Fontes consultadas</strong>
      <ul>{sources.map(source => <li key={source.url}>
        <a href={source.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
          <span>{source.title}</span><ExternalLink size={13} aria-hidden="true" />
        </a>
        <small>{source.host}</small>
      </li>)}</ul>
    </section> : null}
  </div>
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
  const location = useLocation()
  const launcherSource = (location.state as { from?: unknown } | null)?.from
  const returnTo = typeof launcherSource === 'string' && /^\/app(?:\/|\?|$)/.test(launcherSource)
    && !launcherSource.startsWith('/app/assistente') ? launcherSource : null
  const [messages, setMessages] = useState<Message[]>([])
  const [conversations, setConversations] = useState<AssistantConversation[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [moreConversations, setMoreConversations] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [draft, setDraft] = useState<ActionDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [modelStatus, setModelStatus] = useState<AssistantStatus | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const { conversations: saved } = await api.assistantConversations()
        if (!active) return
        setConversations(saved)
        setMoreConversations(saved.length === 100)
        if (saved.length) {
          const detail = await api.assistantConversation(saved[0].id)
          if (!active) return
          setConversationId(detail.conversation.id)
          setMessages(detail.messages)
        }
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : 'Não consegui carregar as conversas salvas.')
      } finally {
        if (active) setHistoryLoading(false)
      }
    })()
    return () => { active = false }
  }, [])
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

  const refreshConversations = async () => {
    try {
      const { conversations: saved } = await api.assistantConversations()
      setConversations(saved)
      setMoreConversations(saved.length === 100)
    } catch { /* the current conversation remains usable if the list fails to refresh */ }
  }

  const loadMoreConversations = async () => {
    if (busy || historyLoading || loadingMore || !moreConversations) return
    setLoadingMore(true)
    try {
      const { conversations: older } = await api.assistantConversations(conversations.length)
      setConversations(current => [...current, ...older.filter(item =>
        !current.some(existing => existing.id === item.id))])
      setMoreConversations(older.length === 100)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não consegui carregar mais conversas.')
    } finally { setLoadingMore(false) }
  }

  const startNewConversation = () => {
    if (busy || historyLoading || deletingId) return
    setConversationId(null)
    setMessages([])
    setDraft(null)
    setError('')
    setInput('')
    setHistoryOpen(false)
  }

  const openConversation = async (id: string) => {
    if (busy || historyLoading || deletingId) return
    if (id === conversationId) { setHistoryOpen(false); return }
    setHistoryLoading(true)
    try {
      const detail = await api.assistantConversation(id)
      setConversationId(detail.conversation.id)
      setMessages(detail.messages)
      setDraft(null)
      setInput('')
      setError('')
      setHistoryOpen(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não consegui abrir esta conversa.')
    } finally { setHistoryLoading(false) }
  }

  const deleteConversation = async (id: string) => {
    if (busy || historyLoading || deletingId || !window.confirm('Apagar esta conversa da Nayla?')) return
    setDeletingId(id)
    try {
      await api.deleteAssistantConversation(id)
      setConversations(current => current.filter(item => item.id !== id))
      if (id === conversationId) {
        setConversationId(null)
        setMessages([])
        setDraft(null)
        setInput('')
      }
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não consegui apagar esta conversa.')
    } finally { setDeletingId(null) }
  }

  const addAssistant = (text: string) => setMessages(current => [
    ...current, { id: crypto.randomUUID(), role: 'assistant', text },
  ])

  const send = async (value: string) => {
    const text = value.trim()
    if (!text || busy || historyLoading || deletingId) return
    const pendingId = crypto.randomUUID()
    setInput('')
    setError('')
    setDraft(null)
    setBusy(true)
    setMessages(current => [...current, { id: pendingId, role: 'user', text }])
    try {
      const kind = requestedAction(text)
      if (kind) {
        const today = saoPauloDate()
        const end = new Date(`${today}T12:00:00Z`)
        end.setUTCDate(end.getUTCDate() + 180)
        const appointments = (await api.appointments(today, end.toISOString().slice(0, 10)))
          .filter(item => ['pending', 'confirmed'].includes(item.status) && Date.parse(item.startsAt) > Date.now())
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
        const prepared = await api.prepareAssistantAction(text, kind, conversationId || undefined)
        setConversationId(prepared.conversationId)
        setMessages(current => [...current.map(item => item.id === pendingId
          ? { ...item, id: prepared.userMessageId } : item),
        { id: prepared.assistantMessageId, role: 'assistant', text: prepared.answer }])
        void refreshConversations()
        if (appointments.length) {
          setDraft({ kind, appointments, selectedId: '', search: '', reason: '', stage: 'select' })
        }
      } else {
        const response = await api.assistant(text, conversationId || undefined)
        if (response.mode === 'ai') setModelStatus(current => ({
          provider: 'ollama', model: current?.model || 'local', aiAvailable: true,
        }))
        if (response.mode === 'local') void api.assistantStatus().then(setModelStatus).catch(() => {
          // The answer remains useful even when model status cannot be refreshed.
        })
        setConversationId(response.conversationId)
        setMessages(current => [...current.map(item => item.id === pendingId
          ? { ...item, id: response.userMessageId } : item),
        { id: response.assistantMessageId, role: 'assistant', text: response.answer }])
        void refreshConversations()
      }
    } catch (reason) {
      setMessages(current => current.filter(item => item.id !== pendingId))
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
      const localResult = `${draft.kind === 'reschedule-request' ? 'Pedido de remarcação registrado' : 'Agendamento cancelado'} para ${selected.clientName} (${selected.serviceName}, ${dateTime(selected.startsAt)}). O horário antigo foi liberado. ${notificationMessage(result.notificationStatus)}`
      try {
        if (!conversationId || !result.eventId) throw new Error('Registro da conversa indisponível.')
        const recorded = await api.recordAssistantActionResult(conversationId, result.eventId)
        setMessages(current => [...current, { id: recorded.assistantMessageId, role: 'assistant', text: recorded.answer }])
        void refreshConversations()
      } catch {
        addAssistant(localResult)
        setError('A alteração foi concluída, mas não consegui salvar a confirmação nesta conversa. Confira a agenda.')
      }
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
  return <div className="page assistant-page">
    {returnTo ? <Link className="assistant-mobile-return" to={returnTo}><ArrowLeft size={17} /> Voltar à tela anterior</Link> : null}
    <PageHeading eyebrow="SUA ASSISTENTE" title="Converse com a Nayla"
      description="Pergunte sobre seu espaço, suas clientes e sua área. A Nayla combina seus dados com fontes públicas quando consulta a internet." />
    <div className="assistant-history-toolbar">
      <button type="button" className="assistant-history-toggle" aria-expanded={historyOpen}
        aria-controls="assistant-saved-conversations" onClick={() => setHistoryOpen(value => !value)}>
        <History size={17} /> Conversas salvas <span>{conversations.length}</span>
      </button>
      <button type="button" className="assistant-new-button" onClick={startNewConversation}
        disabled={busy || historyLoading || Boolean(deletingId)}><Plus size={17} /> Nova conversa</button>
    </div>
    <div className="assistant-workspace">
      <aside id="assistant-saved-conversations" className={`assistant-history ${historyOpen ? 'open' : ''}`}
        aria-label="Conversas salvas da Nayla">
        <div className="assistant-history-heading"><History size={17} /><strong>Conversas salvas</strong></div>
        {historyLoading && !conversations.length ? <p role="status">Carregando conversas...</p> :
          conversations.length ? <div className="assistant-history-list">{conversations.map(item =>
            <div className={`assistant-history-item ${item.id === conversationId ? 'active' : ''}`} key={item.id}>
              <button type="button" className="assistant-history-open" aria-current={item.id === conversationId ? 'true' : undefined}
                disabled={busy || historyLoading || Boolean(deletingId)} onClick={() => void openConversation(item.id)}>
                <strong>{item.title}</strong><span>{item.preview}</span>
                <small>{conversationDate(item.updatedAt)} · {item.messageCount} mensagens</small>
              </button>
              <button type="button" className="assistant-history-delete" aria-label={`Apagar conversa: ${item.title}`}
                title="Apagar conversa" disabled={busy || historyLoading || Boolean(deletingId)}
                onClick={() => void deleteConversation(item.id)}><Trash2 size={15} /></button>
            </div>)}
            {moreConversations ? <button type="button" className="assistant-history-more"
              disabled={busy || historyLoading || loadingMore} onClick={() => void loadMoreConversations()}>
              {loadingMore ? 'Carregando...' : 'Carregar conversas anteriores'}
            </button> : null}
          </div> : <p>Suas conversas aparecerão aqui depois da primeira pergunta.</p>}
      </aside>
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
      </div>
      <div className="chat-messages">
        {messages.length === 0
          ? <div className="chat-empty">
            <span className="chat-empty-icon"><Sparkles size={29}/></span>
            <h2>Oi, {session?.user.name.split(' ')[0]}! Como posso ajudar?</h2>
            <p>{modelStatus === null
              ? 'Escolha uma sugestão enquanto verifico a IA local.'
              : modelStatus.aiAvailable
                ? 'Converse sobre seu negócio e sua área. Quando consultar fontes públicas, a Nayla mostra os links na resposta.'
                : 'Posso analisar seus dados, explicar o app e buscar fontes públicas para dicas da sua área. A conversa livre depende da IA local.'}</p>
            <div className="prompt-grid">
              {prompts.map(prompt => <button type="button" key={prompt.text} disabled={busy || historyLoading}
                onClick={() => void send(prompt.text)}>{prompt.icon}<span>{prompt.text}</span></button>)}
            </div>
          </div>
          : <div className="message-stack">
            {messages.map(message => <div className={`chat-message ${message.role}`} key={message.id}>
              {message.role === 'assistant' ? <span className="message-avatar"><Sparkles size={16}/></span> : null}
              {message.role === 'assistant'
                ? <AssistantMessageContent text={message.text} />
                : <div>{message.text}</div>}
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
          <button type="submit" disabled={!input.trim() || busy || historyLoading} aria-label="Enviar mensagem"><ArrowUp size={20}/></button>
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <small>Enter envia · Shift+Enter quebra linha. A Nayla usa os dados do seu espaço e, quando necessário, fontes públicas. Alterações precisam da sua confirmação.</small>
      </form>
    </Panel>
    </div>
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
