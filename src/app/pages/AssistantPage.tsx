import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowUp, CalendarDays, CircleDollarSign, Heart, Sparkles } from 'lucide-react'
import { api } from '../../lib/api'
import { useAuth } from '../contexts'
import { PageHeading, Panel } from '../shared'

type Message = { id: string; role: 'user' | 'assistant'; text: string }
const prompts = [
  { icon: <CircleDollarSign size={18}/>, text: 'Quanto faturei este mês?' },
  { icon: <CalendarDays size={18}/>, text: 'Qual é a minha próxima cliente?' },
  { icon: <Heart size={18}/>, text: 'Quais clientes não voltaram há mais de um mês?' },
  { icon: <Sparkles size={18}/>, text: 'Como cadastro um novo serviço?' },
]

export function AssistantPage() {
  const { session } = useAuth()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, busy])
  const send = async (value: string) => { const text = value.trim(); if (!text || busy) return; setInput(''); setError(''); setBusy(true); setMessages(current => [...current, { id: crypto.randomUUID(), role: 'user', text }]); try { const response = await api.assistant(text); setMessages(current => [...current, { id: crypto.randomUUID(), role: 'assistant', text: response.answer }]) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não consegui responder agora. Tente novamente.') } finally { setBusy(false) } }
  const submit = (event: FormEvent) => { event.preventDefault(); void send(input) }
  return <div className="page assistant-page"><PageHeading eyebrow="SUA ASSISTENTE" title="Converse com a Nayla" description="Uma ajuda prática para entender sua agenda, clientes e resultados." /><Panel className="chat-panel"><div className="chat-top"><span className="chat-avatar"><Sparkles size={22}/></span><div><strong>Nayla IA</strong><small><span className="online-dot"/> Pronta para ajudar</small></div></div><div className="chat-messages">{messages.length === 0 ? <div className="chat-empty"><span className="chat-empty-icon"><Sparkles size={29}/></span><h2>Oi, {session?.user.name.split(' ')[0]}! Como posso ajudar?</h2><p>Pergunte sobre seu negócio ou escolha uma sugestão para começar.</p><div className="prompt-grid">{prompts.map(prompt => <button key={prompt.text} onClick={() => void send(prompt.text)}>{prompt.icon}<span>{prompt.text}</span></button>)}</div></div> : <div className="message-stack">{messages.map(message => <div className={`chat-message ${message.role}`} key={message.id}>{message.role === 'assistant' ? <span className="message-avatar"><Sparkles size={16}/></span> : null}<div>{message.text}</div></div>)}{busy ? <div className="chat-message assistant"><span className="message-avatar"><Sparkles size={16}/></span><div className="typing"><i/><i/><i/></div></div> : null}<div ref={endRef}/></div>}</div><form className="chat-form" onSubmit={submit}><div className="chat-input-wrap"><input aria-label="Mensagem para Nayla" value={input} onChange={event => setInput(event.target.value)} placeholder="Pergunte qualquer coisa sobre seu negócio..." maxLength={1000} /><button type="submit" disabled={!input.trim() || busy} aria-label="Enviar mensagem"><ArrowUp size={20}/></button></div>{error ? <p className="form-error" role="alert">{error}</p> : null}<small>A Nayla consulta apenas os dados do seu próprio espaço.</small></form></Panel></div>
}
