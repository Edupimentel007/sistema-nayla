import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, CalendarDays, Check, ChevronRight, Clock3, Heart, LoaderCircle, LogOut, MapPin, Moon, Phone, Scissors, Sparkles, Sun } from 'lucide-react'
import { api, type Appointment, type ClientSession, type GoogleCompletion, type NotificationStatus, type PublicBusiness, type ServiceCategory } from '../../lib/api'
import { clearGoogleAppNonce, currentGoogleAppNonce, readGoogleErrorFromUrl, readGoogleTicketFromUrl } from '../../lib/googleAuth'
import { BusinessLogo } from '../BusinessLogo'
import { GoogleSignInButton } from '../GoogleSignInButton'
import { useTheme } from '../contexts'
import { EmptyState, ErrorState, fullDate, Loading, localISODate, Logo, money, serviceCategories, specialties } from '../shared'
import { ClientAppointmentCard } from './ClientAppointmentCard'
import { ClientWhatsAppPreference } from './ClientWhatsAppPreference'
import { DeleteAccountPanel } from './DeleteAccountPanel'
import './public-motion.css'

function PublicThemeButton() { const { theme, toggleTheme } = useTheme(); return <button className="icon-button" type="button" onClick={toggleTheme} aria-label={theme === 'light' ? 'Ativar tema escuro' : 'Ativar tema claro'}>{theme === 'light' ? <Moon size={19}/> : <Sun size={19}/>}</button> }

function BookingHeader({ slug, name, action }: { slug: string; name?: string; action?: ReactNode }) {
  return <header className="booking-header"><Link to="/" aria-label="Nayla"><Logo small/></Link><div className="booking-header-right">{name ? <Link className="booking-header-business" to={`/agendar/${slug}`}>{name}</Link> : null}{action}<PublicThemeButton/></div></header>
}

function BusinessHero({ business }: { business: PublicBusiness['business'] }) {
  return <div className="booking-hero"><BusinessLogo name={business.name} logoUrl={business.logoUrl} className="business-logo-public"/><span className="eyebrow">AGENDAMENTO ONLINE</span><h1>{business.name}</h1><p>{business.description || 'Escolha seu serviço e encontre o melhor horário para cuidar de você.'}</p><div className="business-details">{business.specialties?.map(item => <span key={item}><Scissors size={14}/>{specialties[item] ?? item}</span>)}{business.address ? <span><MapPin size={14}/>{business.address}</span> : null}{business.phone ? <span><Phone size={14}/>{business.phone}</span> : null}</div></div>
}

function usePublicBusiness(slug: string) {
  const [data, setData] = useState<PublicBusiness | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => { if (!slug) return; let live = true; setLoading(true); setError(''); api.publicBusiness(slug).then(value => { if (live) setData(value) }).catch(reason => { if (live) setError(reason instanceof Error ? reason.message : 'Não foi possível abrir esta página.') }).finally(() => { if (live) setLoading(false) }); return () => { live = false } }, [slug, retry])
  return { data, loading, error, retry: () => setRetry(value => value + 1) }
}

const onlyDigits = (value: string) => value.replace(/\D/g, '')
const cpfMask = (value: string) => { const digits = onlyDigits(value).slice(0, 11); return digits.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1-$2') }
const phoneMask = (value: string) => { const digits = onlyDigits(value).slice(0, 11); if (digits.length <= 2) return digits ? `(${digits}` : ''; if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`; return `(${digits.slice(0, 2)}) ${digits.slice(2, digits.length === 11 ? 7 : 6)}-${digits.slice(digits.length === 11 ? 7 : 6)}` }
const validCpf = (value: string) => { const digits = onlyDigits(value); if (digits.length !== 11 || /^(\d)\1+$/.test(digits)) return false; for (let length = 9; length <= 10; length++) { let sum = 0; for (let i = 0; i < length; i++) sum += Number(digits[i]) * (length + 1 - i); const check = (sum * 10) % 11 % 10; if (check !== Number(digits[length])) return false } return true }

const confirmationNotes: Record<NotificationStatus, string> = {
  pending: 'A confirmação está em processamento. Seu agendamento foi salvo normalmente.',
  opted_out: 'Você preferiu não receber mensagem. Seu agendamento foi salvo normalmente.',
  simulated: 'Simulado — não enviado ao WhatsApp. Seu agendamento foi salvo normalmente.',
  not_configured: 'A confirmação por WhatsApp está indisponível agora. Seu agendamento foi salvo normalmente.',
  accepted: 'A confirmação foi aceita pelo WhatsApp. A entrega ainda não foi confirmada.',
  sent: 'A confirmação foi aceita pelo WhatsApp. A entrega ainda não foi confirmada.',
  delivered: 'A confirmação foi entregue pelo WhatsApp.',
  read: 'A confirmação foi lida no WhatsApp.',
  failed: 'Não foi possível enviar a confirmação pelo WhatsApp. Seu agendamento foi salvo normalmente.',
}

export function BookingPage() {
  const { slug = '' } = useParams()
  const { data, loading, error, retry } = usePublicBusiness(slug)
  const [clientSession, setClientSession] = useState<ClientSession | null>(null)
  const [serviceId, setServiceId] = useState('')
  const [date, setDate] = useState(localISODate)
  const [slots, setSlots] = useState<string[]>([])
  const [slotLoading, setSlotLoading] = useState(false)
  const [slotError, setSlotError] = useState('')
  const [slotRetry, setSlotRetry] = useState(0)
  const [time, setTime] = useState('')
  const [step, setStep] = useState(1)
  const [name, setName] = useState('')
  const [cpf, setCpf] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [whatsappOptIn, setWhatsappOptIn] = useState(false)
  const [booking, setBooking] = useState(false)
  const [bookingError, setBookingError] = useState('')
  const [confirmation, setConfirmation] = useState<Appointment | null>(null)
  const [notificationStatus, setNotificationStatus] = useState<NotificationStatus | null>(null)
  useEffect(() => { if (!slug) return; let live = true; api.clientMe(slug).then(value => { if (live) { setClientSession(value); setName(value.client.name); setCpf(cpfMask(value.client.cpf ?? '')); setPhone(phoneMask(value.client.phone)); setEmail(value.client.email ?? ''); setWhatsappOptIn(Boolean(value.client.whatsappOptIn)) } }).catch(() => {}); return () => { live = false } }, [slug])
  useEffect(() => { if (!slug || !serviceId || !date) return; let live = true; setSlotLoading(true); setSlotError(''); setTime(''); api.availability(slug, serviceId, date).then(value => { if (live) setSlots(value.slots) }).catch(reason => { if (live) setSlotError(reason instanceof Error ? reason.message : 'Não foi possível carregar horários.') }).finally(() => { if (live) setSlotLoading(false) }); return () => { live = false } }, [slug, serviceId, date, slotRetry])
  const activeServices = useMemo(() => data?.services.filter(item => item.active) ?? [], [data])
  const service = activeServices.find(item => item.id === serviceId)
  const categories = [...new Set(activeServices.map(item => item.category))] as ServiceCategory[]
  const goDetails = () => { if (serviceId && time) { setBookingError(''); setStep(2) } }
  const book = async (event: FormEvent) => { event.preventDefault(); setBookingError(''); if (!validCpf(cpf)) { setBookingError('Informe um CPF válido.'); return } if (onlyDigits(phone).length < 10) { setBookingError('Informe um telefone válido.'); return } if (!clientSession && !password) { setBookingError('Informe ou crie uma senha para continuar.'); return } setBooking(true); try { const result = await api.book(slug, { serviceId, date, time, remember, client: { name: name.trim(), cpf: onlyDigits(cpf), phone: onlyDigits(phone), email: email.trim() || undefined, password: password || undefined, whatsappOptIn } }); setConfirmation(result.appointment); setNotificationStatus(result.notificationStatus); setStep(3); void api.clientMe(slug).then(setClientSession).catch(() => {}) } catch (reason) { setBookingError(reason instanceof Error ? reason.message : 'Não foi possível agendar. Tente outro horário.') } finally { setBooking(false) } }
  return <div className="booking-site"><BookingHeader slug={slug} name={data?.business.name} action={clientSession ? <Link className="header-login" to={`/agendar/${slug}/meus-agendamentos`}>Meus horários <ChevronRight size={16}/></Link> : <Link className="header-login" to={`/agendar/${slug}/entrar`}>Entrar <ChevronRight size={16}/></Link>} /><main className="booking-container">{loading ? <Loading label="Abrindo página de agendamento..." /> : error ? <ErrorState message={error} onRetry={retry} /> : data ? <><BusinessHero business={data.business}/>{confirmation ? <div className="booking-success"><span><Check size={35}/></span><h2>Agendamento confirmado!</h2><p>Seu horário com {data.business.name} foi reservado. Guarde essas informações:</p><div className="success-detail"><strong>{confirmation.serviceName || service?.name}</strong><span><CalendarDays size={17}/> {fullDate(confirmation.startsAt || `${date}T12:00:00`)}</span><span><Clock3 size={17}/> {time}</span><span>{money(confirmation.price ?? service?.price)}</span></div><p className="success-note">{notificationStatus ? confirmationNotes[notificationStatus] : 'Guarde os detalhes deste agendamento para consulta.'}</p><div className="success-actions"><Link className="btn btn-primary" to={`/agendar/${slug}/meus-agendamentos`}>Ver meus agendamentos</Link><button className="btn btn-secondary" onClick={() => { setConfirmation(null); setServiceId(''); setTime(''); setWhatsappOptIn(false); setStep(1) }}>Agendar outro serviço</button></div></div> : <div className="booking-layout"><div className="booking-form-area" key={step} data-step={step}><div className="booking-stepper"><span className={step >= 1 ? 'current' : ''}><b>1</b> Serviço e horário</span><span className="step-line"/><span className={step >= 2 ? 'current' : ''}><b>2</b> Seus dados</span></div>{step === 1 ? <><div className="booking-section-heading"><span className="eyebrow">PASSO 01</span><h2>O que vamos fazer hoje?</h2><p>Escolha o serviço que combina com você.</p></div>{activeServices.length ? <div className="booking-services">{categories.map(category => <div key={category}><h3>{serviceCategories[category]}</h3><div className="booking-service-list">{activeServices.filter(item => item.category === category).map(item => <button type="button" aria-pressed={serviceId === item.id} className={`booking-service ${serviceId === item.id ? 'selected' : ''}`} key={item.id} onClick={() => { setServiceId(item.id); setTime('') }}><span className="booking-service-radio"><Check size={14}/></span><span className="booking-service-info"><strong>{item.name}</strong>{item.description ? <small>{item.description}</small> : null}<small><Clock3 size={13}/> {item.durationMinutes} min</small></span><strong>{money(item.price)}</strong></button>)}</div></div>)}</div> : <EmptyState title="Ainda não há serviços disponíveis" detail="Volte mais tarde para conferir os serviços deste espaço." />}{service ? <div className="booking-date-section"><div className="booking-section-heading"><span className="eyebrow">ESCOLHA A DATA</span><h2>Quando fica melhor para você?</h2></div><label className="booking-date-input"><CalendarDays size={19}/><input type="date" min={localISODate()} value={date} onChange={event => setDate(event.target.value)} aria-label="Data do agendamento" /></label><h3>Horários disponíveis</h3>{slotLoading ? <div className="slot-loading"><LoaderCircle className="spin" size={20}/> Buscando horários...</div> : slotError ? <ErrorState message={slotError} onRetry={() => setSlotRetry(value => value + 1)} /> : slots.length ? <div className="slots">{slots.map(slot => <button type="button" aria-pressed={time === slot} key={slot} className={time === slot ? 'selected' : ''} onClick={() => setTime(slot)}>{slot}</button>)}</div> : <EmptyState title="Sem horários nesta data" detail="Escolha outro dia para encontrar disponibilidade." />}</div> : null}<div className="booking-step-actions"><button type="button" className="btn btn-primary" onClick={goDetails} disabled={!serviceId || !time}>Continuar <ArrowRight size={18}/></button></div></> : <><div className="booking-section-heading"><span className="eyebrow">PASSO 02</span><h2>Para quem é esse cuidado?</h2><p>Preencha seus dados para confirmar o horário.</p></div>{!clientSession ? <div className="returning-client">Já agendou aqui antes? <Link to={`/agendar/${slug}/entrar`}>Entre na sua conta</Link></div> : <div className="returning-client">Agendando como <strong>{clientSession.client.name}</strong>.</div>}<form className="form-stack booking-contact-form" onSubmit={book}><label>Nome completo<input value={name} onChange={e => setName(e.target.value)} placeholder="Seu nome completo" autoComplete="name" readOnly={Boolean(clientSession)} required /></label><div className="form-row"><label>CPF<input value={cpf} onChange={e => setCpf(cpfMask(e.target.value))} placeholder="000.000.000-00" inputMode="numeric" readOnly={Boolean(clientSession)} required /></label><label>Telefone / WhatsApp<input value={phone} onChange={e => setPhone(phoneMask(e.target.value))} placeholder="(00) 00000-0000" inputMode="tel" required /></label></div><label>E-mail (opcional)<input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="voce@exemplo.com" autoComplete="email" /></label>{!clientSession ? <label>Senha de acesso<input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Crie ou informe sua senha" autoComplete="new-password" required /><small>Primeira visita: crie uma senha com 12 ou mais caracteres, letras e números. Se já tem conta, informe sua senha atual ou entre antes de agendar.</small></label> : null}<label className="remember-choice"><input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} /> Manter conectado neste dispositivo por até 7 dias</label><label className="whatsapp-opt-in"><input type="checkbox" checked={whatsappOptIn} onChange={event => setWhatsappOptIn(event.target.checked)} /><span><strong>Quero receber avisos do agendamento pelo WhatsApp</strong><small>Confirmações, alterações, cancelamentos e lembretes serão enviados ao número informado quando a profissional configurar o WhatsApp. Você pode agendar sem receber mensagens.</small></span></label>{bookingError ? <p className="form-error" role="alert">{bookingError}</p> : null}<div className="booking-step-actions"><button type="button" className="btn btn-secondary" onClick={() => setStep(1)}><ArrowLeft size={17}/> Voltar</button><button className="btn btn-primary" disabled={booking}>{booking ? 'Confirmando...' : 'Confirmar agendamento'} <Check size={18}/></button></div></form></>}</div><aside className="booking-summary"><span className="summary-icon"><Heart size={21} fill="currentColor"/></span><h3>Seu momento de cuidado</h3><p>Confira os detalhes antes de confirmar.</p><div className="summary-lines"><div><span>Serviço</span><strong>{service?.name ?? 'Escolha um serviço'}</strong></div><div><span>Data</span><strong>{service && date ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long' }).format(new Date(`${date}T12:00:00`)) : 'A definir'}</strong></div><div><span>Horário</span><strong>{time || 'A definir'}</strong></div><div><span>Duração</span><strong>{service ? `${service.durationMinutes} min` : 'A definir'}</strong></div></div><div className="summary-total"><span>Valor</span><strong>{service ? money(service.price) : '—'}</strong></div><small><Sparkles size={14}/> Um tempinho só para você.</small></aside></div>}</> : null}</main><footer className="booking-footer">Agendamento com carinho via <Link to="/">nayla.</Link></footer></div>
}

export function ClientLoginPage() {
  const { slug = '' } = useParams()
  const navigate = useNavigate()
  const { data, loading, error, retry } = usePublicBusiness(slug)
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [pending, setPending] = useState<{ ticket: string; email: string; registrationRequired: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [loginError, setLoginError] = useState('')
  const applyGoogle = (result: GoogleCompletion, ticket = '') => {
    if ('user' in result) {
      clearGoogleAppNonce()
      navigate(`/agendar/${slug}/meus-agendamentos`, { replace: true })
      return
    }
    setPending({ ticket: ticket || result.googleTicket || '', email: result.email,
      registrationRequired: result.registrationRequired })
    setName(result.name)
  }
  useEffect(() => {
    const ticket = readGoogleTicketFromUrl()
    const googleError = readGoogleErrorFromUrl()
    if (googleError) setLoginError(googleError)
    if (ticket) api.googleComplete('client', ticket).then(result => applyGoogle(result, ticket))
      .catch(reason => setLoginError(reason instanceof Error ? reason.message : 'Não foi possível entrar com Google.'))
    // The redirect ticket is read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setLoginError('')
    try {
      if (pending) {
        if (pending.registrationRequired) {
          if (!validCpf(identifier)) throw new Error('Informe um CPF válido.')
          if (onlyDigits(phone).length < 10) throw new Error('Informe seu telefone com DDD.')
          if (password.length < 12 || !/[A-Za-z]/.test(password) || !/\d/.test(password))
            throw new Error('Use uma senha com 12 ou mais caracteres, letras e números.')
          await api.googleRegister('client', pending.ticket,
            { name: name.trim(), cpf: onlyDigits(identifier), phone: onlyDigits(phone), password },
            currentGoogleAppNonce())
        } else {
          await api.googleLink('client', pending.ticket, password, onlyDigits(identifier), currentGoogleAppNonce())
        }
      } else await api.clientLogin(slug, onlyDigits(identifier), password, remember)
      clearGoogleAppNonce()
      navigate(`/agendar/${slug}/meus-agendamentos`, { replace: true })
    } catch (reason) {
      setLoginError(reason instanceof Error ? reason.message : 'Não foi possível entrar.')
    } finally { setBusy(false) }
  }
  return <div className="booking-site"><BookingHeader slug={slug} name={data?.business.name}/>
    <main className="client-auth-container">{loading ? <Loading/> : error ? <ErrorState message={error} onRetry={retry}/> : data ? <>
      <Link className="back-link" to={`/agendar/${slug}`}><ArrowLeft size={17}/> Voltar ao agendamento</Link>
      <div className="client-auth-card"><BusinessLogo name={data.business.name} logoUrl={data.business.logoUrl} className="business-logo-public"/>
        <span className="eyebrow">ÁREA DA CLIENTE · {data.business.name}</span>
        <h1>{pending?.registrationRequired ? 'Complete seu acesso' : pending ? 'Conecte sua conta' : 'Entre para acompanhar seus horários'}</h1>
        <p>{pending?.registrationRequired ? `Google confirmado para ${pending.email}. Informe seus dados para criar sua conta neste espaço.`
          : pending ? 'Confirme a senha que você já usa aqui para vincular sua conta Google.'
          : 'Consulte, altere ou cancele seus agendamentos com segurança.'}</p>
        <form className="form-stack" onSubmit={submit}>
          {pending?.registrationRequired ? <><label>Nome completo<input value={name} onChange={event => setName(event.target.value)} autoComplete="name" required /></label>
            <label>Telefone / WhatsApp<input value={phone} onChange={event => setPhone(phoneMask(event.target.value))} placeholder="(00) 00000-0000" inputMode="tel" autoComplete="tel" required /></label></> : null}
          <label>CPF<input value={identifier} onChange={event => setIdentifier(cpfMask(event.target.value))} placeholder="000.000.000-00" inputMode="numeric" autoComplete="username" required /></label>
          <label>Senha<input type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder={pending?.registrationRequired ? 'Crie uma senha forte' : 'Sua senha'}
            autoComplete={pending?.registrationRequired ? 'new-password' : 'current-password'} minLength={pending?.registrationRequired ? 12 : undefined} required />
            {pending?.registrationRequired ? <small className="auth-help">Use 12 ou mais caracteres, letras e números. Você também poderá entrar com CPF e senha.</small> : null}</label>
          {!pending ? <><label className="remember-choice"><input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} /> Manter conectado neste dispositivo</label>
            <p className="auth-help">O acesso salvo dura até 7 dias. Depois, será preciso entrar novamente.</p></> : null}
          {loginError ? <p className="form-error" role="alert">{loginError}</p> : null}
          <button className="btn btn-primary btn-full" disabled={busy}>{busy ? 'Aguarde...' : pending?.registrationRequired ? 'Criar conta' : pending ? 'Conectar e entrar' : 'Entrar'} <ArrowRight size={17}/></button>
        </form>
        {!pending ? <GoogleSignInButton role="client" slug={slug} remember={remember} onResult={applyGoogle} onError={setLoginError}/> : null}
        <p className="auth-switch">Primeira visita? <Link to={`/agendar/${slug}`}>Escolha um serviço e agende</Link></p>
      </div></> : null}</main></div>
}
export function ClientAppointmentsPage() {
  const { slug = '' } = useParams()
  const navigate = useNavigate()
  const { data, loading: businessLoading, error: businessError, retry } = usePublicBusiness(slug)
  const [client, setClient] = useState<ClientSession | null>(null)
  const [items, setItems] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retryItems, setRetryItems] = useState(0)
  useEffect(() => { if (!slug) return; let live = true; setLoading(true); setError(''); Promise.all([api.clientMe(slug), api.clientAppointments(slug)]).then(([session, appointments]) => { if (live) { setClient(session); setItems(appointments) } }).catch(reason => { if (!live) return; if (reason?.status === 401) navigate(`/agendar/${slug}/entrar`, { replace: true }); else setError(reason instanceof Error ? reason.message : 'Não foi possível carregar seus agendamentos.') }).finally(() => { if (live) setLoading(false) }); return () => { live = false } }, [slug, retryItems, navigate])
  const signOut = async () => { try { await api.clientLogout(slug); navigate(`/agendar/${slug}/entrar`, { replace: true }) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível sair agora.') } }
  const appointmentUpdated = (updated: Appointment) => setItems(current => current.map(appointment => appointment.id === updated.id ? updated : appointment))
  const accountDeleted = () => { setClient(null); setItems([]); navigate('/', { replace: true }) }
  const sorted = [...items].sort((a, b) => b.startsAt.localeCompare(a.startsAt))
  return <div className="booking-site"><BookingHeader slug={slug} name={data?.business.name} action={<button className="header-login" onClick={() => void signOut()}>Sair <LogOut size={16}/></button>}/><main className="client-appointments-container">{businessLoading ? <Loading/> : businessError ? <ErrorState message={businessError} onRetry={retry}/> : <><div className="client-page-top"><div><span className="eyebrow">SEU ESPAÇO</span><h1>Olá, {client?.client.name.split(' ')[0] ?? 'cliente'}!</h1><p>Acompanhe seus momentos de cuidado com {data?.business.name}.</p></div><Link className="btn btn-primary" to={`/agendar/${slug}`}>Novo agendamento <ArrowRight size={17}/></Link></div>{client ? <ClientWhatsAppPreference slug={slug} client={client} onUpdated={setClient}/> : null}{loading ? <Loading label="Carregando seus horários..."/> : error ? <ErrorState message={error} onRetry={() => setRetryItems(value => value + 1)}/> : sorted.length ? <div className="client-appointment-list">{sorted.map(item => <ClientAppointmentCard key={item.id} slug={slug} businessName={data?.business.name} item={item} services={data?.services ?? []} onUpdated={appointmentUpdated}/>)}</div> : <EmptyState title="Você ainda não tem agendamentos" detail="Escolha um serviço e reserve seu próximo momento de cuidado." action={<Link className="btn btn-primary" to={`/agendar/${slug}`}>Agendar agora</Link>}/>}{client ? <DeleteAccountPanel kind="client" onDeleted={accountDeleted}/> : null}</>}</main></div>
}
