import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, Check, Moon, ShieldCheck, Sun } from 'lucide-react'
import { api, type GoogleCompletion, type Specialty } from '../../lib/api'
import { clearGoogleAppNonce, currentGoogleAppNonce, readGoogleErrorFromUrl, readGoogleTicketFromUrl } from '../../lib/googleAuth'
import { GoogleSignInButton } from '../GoogleSignInButton'
import { useAuth, useTheme } from '../contexts'
import { Logo, specialties } from '../shared'

type GooglePending = { ticket: string; email: string; name: string; passwordLinkRequired: boolean }
const strongPassword = (value: string) => value.length >= 12 && /[A-Za-z]/.test(value) && /\d/.test(value)
const slugify = (text: string) => text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

function AuthLayout({ children, title, subtitle }: { children: ReactNode; title: string; subtitle: string }) {
  const { theme, toggleTheme } = useTheme()
  return <div className="auth-page"><div className="auth-visual"><Link to="/"><Logo /></Link>
    <div className="auth-visual-content"><span className="eyebrow">NAYLA PARA PROFISSIONAIS</span>
      <h2>Uma rotina organizada para o seu trabalho crescer.</h2>
      <p>Agenda, clientes, finanças e análises no mesmo espaço, com uma experiência feita para o seu dia.</p>
      <div className="auth-benefits"><span><Check size={16} /> Sua página de agendamento</span>
        <span><Check size={16} /> Serviços da sua área</span><span><Check size={16} /> Dados claros para decidir</span></div>
    </div><small>Nayla · gestão para profissionais de beleza</small></div>
    <div className="auth-main"><div className="auth-mobile-top"><Link to="/"><Logo small /></Link>
      <button className="icon-button" type="button" onClick={toggleTheme} aria-label={theme === 'light' ? 'Ativar tema escuro' : 'Ativar tema claro'}>{theme === 'light' ? <Moon size={19}/> : <Sun size={19}/>}</button></div>
      <div className="auth-card"><div className="auth-heading"><span className="eyebrow">ÁREA DA PROFISSIONAL</span><h1>{title}</h1><p>{subtitle}</p></div>{children}</div>
      <div className="auth-foot"><button className="subtle-link" type="button" onClick={toggleTheme}>Tema {theme === 'light' ? 'escuro' : 'claro'}</button><span>© {new Date().getFullYear()} Nayla</span></div>
    </div></div>
}

export function OwnerLoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { setSession } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [pending, setPending] = useState<GooglePending | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const destination = (location.state as { from?: string } | null)?.from || '/app'
  const applyGoogle = (result: GoogleCompletion, ticket = '') => {
    if ('user' in result) { clearGoogleAppNonce(); setSession(result); navigate('/app', { replace: true }); return }
    const next = { ticket: ticket || result.googleTicket || '', email: result.email,
      name: result.name, passwordLinkRequired: result.passwordLinkRequired }
    if (result.registrationRequired) navigate('/cadastro', { state: { google: next }, replace: true })
    else { setPending(next); setEmail(next.email) }
  }
  useEffect(() => {
    const ticket = readGoogleTicketFromUrl()
    const googleError = readGoogleErrorFromUrl()
    if (googleError) setError(googleError)
    if (ticket) api.googleComplete('owner', ticket).then(result => applyGoogle(result, ticket))
      .catch(reason => setError(reason instanceof Error ? reason.message : 'Não foi possível entrar com Google.'))
    else {
      const fromState = (location.state as { google?: GooglePending } | null)?.google
      if (fromState?.passwordLinkRequired) { setPending(fromState); setEmail(fromState.email) }
    }
    // The OAuth ticket is consumed once, after a single redirect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const session = pending
        ? await api.googleLink('owner', pending.ticket, password, undefined, currentGoogleAppNonce())
        : await api.login(email.trim(), password, remember)
      clearGoogleAppNonce(); setSession(session); navigate(destination, { replace: true })
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível entrar.') }
    finally { setBusy(false) }
  }
  return <AuthLayout title={pending ? 'Conecte sua conta ao Google' : 'Entre no seu espaço'}
    subtitle={pending ? `Confirme a senha de ${pending.email} uma vez para vincular essa conta.` : 'Use o e-mail e a senha cadastrados para acessar suas ferramentas.'}>
    <form onSubmit={submit} className="form-stack">
      <label>E-mail<input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)}
        placeholder="voce@exemplo.com" readOnly={Boolean(pending)} required /></label>
      <label>Senha<input type="password" autoComplete="current-password" value={password}
        onChange={event => setPassword(event.target.value)} placeholder="Sua senha" required /></label>
      {!pending ? <><label className="remember-choice"><input type="checkbox" checked={remember}
        onChange={event => setRemember(event.target.checked)} /> Manter conectado neste dispositivo</label>
        <p className="auth-help">Com essa opção, o acesso dura até 7 dias. Depois disso, será preciso entrar novamente. Sem ela, a sessão termina em até 24 horas.</p></> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="btn btn-primary btn-full" disabled={busy}>{busy ? 'Entrando...' : pending ? 'Conectar e entrar' : 'Entrar'} <ArrowRight size={17} /></button>
    </form>
    {pending ? <button className="subtle-link" type="button" onClick={() => { setPending(null); setPassword('') }}>Usar outro acesso</button>
      : <GoogleSignInButton role="owner" remember={remember} onResult={applyGoogle} onError={setError} />}
    <p className="auth-switch">Ainda não tem conta? <Link to="/cadastro">Criar meu espaço</Link></p>
  </AuthLayout>
}

export function OwnerRegisterPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { setSession } = useAuth()
  const fromGoogle = (location.state as { google?: GooglePending } | null)?.google
  const [google, setGoogle] = useState<GooglePending | null>(fromGoogle || null)
  const [ownerName, setOwnerName] = useState(fromGoogle?.name || '')
  const [businessName, setBusinessName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [email, setEmail] = useState(fromGoogle?.email || '')
  const [password, setPassword] = useState('')
  const [selected, setSelected] = useState<Specialty[]>([])
  const [remember, setRemember] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const toggleSpecialty = (item: Specialty) => setSelected(current => current.includes(item)
    ? current.filter(value => value !== item) : [...current, item])
  const applyGoogle = (result: GoogleCompletion) => {
    if ('user' in result) { clearGoogleAppNonce(); setSession(result); navigate('/app', { replace: true }); return }
    const next = { ticket: result.googleTicket || '', email: result.email,
      name: result.name, passwordLinkRequired: result.passwordLinkRequired }
    if (next.passwordLinkRequired) navigate('/entrar', { state: { google: next }, replace: true })
    else { setGoogle(next); setEmail(next.email); setOwnerName(current => current || next.name) }
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError('')
    if (!selected.length) { setError('Selecione pelo menos uma área de atuação.'); return }
    if (!strongPassword(password)) { setError('Crie uma senha com pelo menos 12 caracteres, incluindo letras e números.'); return }
    setBusy(true)
    try {
      const details = { ownerName: ownerName.trim(), businessName: businessName.trim(),
        slug: slugify(slug), email: email.trim(), password, specialties: selected, remember }
      const session = google
        ? await api.googleRegister('owner', google.ticket, details, currentGoogleAppNonce())
        : await api.register(details)
      clearGoogleAppNonce(); setSession(session); navigate('/app', { replace: true })
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível criar sua conta.') }
    finally { setBusy(false) }
  }
  return <AuthLayout title="Crie seu espaço" subtitle="Comece com seus dados, escolha sua área e personalize os serviços depois.">
    {google ? <p className="form-success"><Check size={16} /> Google confirmado para {google.email}. Complete seu espaço e escolha uma senha de recuperação.</p> : null}
    <form onSubmit={submit} className="form-stack">
      <div className="form-row"><label>Seu nome<input value={ownerName} onChange={event => setOwnerName(event.target.value)}
        placeholder="Como podemos chamar você?" autoComplete="name" required /></label>
        <label>Nome do seu espaço<input value={businessName} onChange={event => { setBusinessName(event.target.value); if (!slugEdited) setSlug(slugify(event.target.value)) }}
          placeholder="Ex.: Studio Maria" required /></label></div>
      <label>Seu link de agendamento<div className="input-prefix"><span>/agendar/</span><input value={slug}
        onChange={event => { setSlugEdited(true); setSlug(slugify(event.target.value)) }} placeholder="studio-maria" required /></div>
        <small className="auth-help">As clientes usarão este link para ver apenas os serviços do seu espaço.</small></label>
      <label>E-mail<input type="email" value={email} onChange={event => setEmail(event.target.value)}
        placeholder="voce@exemplo.com" autoComplete="email" readOnly={Boolean(google)} required /></label>
      <label>Senha<input type="password" value={password} onChange={event => setPassword(event.target.value)}
        placeholder="12 ou mais caracteres" autoComplete="new-password" minLength={12} required />
        <small className="auth-help">Use 12 ou mais caracteres, com letras e números. Evite nomes, datas e senhas repetidas.</small></label>
      <fieldset className="specialty-field"><legend>Em quais áreas você atua?</legend>
        <div className="specialty-options">{(Object.keys(specialties) as Specialty[]).map(item =>
          <button key={item} type="button" className={`specialty-choice ${selected.includes(item) ? 'selected' : ''}`}
            aria-pressed={selected.includes(item)} onClick={() => toggleSpecialty(item)}>
            {selected.includes(item) ? <Check size={15} /> : <span className="choice-circle" />}{specialties[item]}
          </button>)}</div><small className="auth-help">Você pode ajustar as áreas e os serviços nas configurações.</small></fieldset>
      {!google ? <><label className="remember-choice"><input type="checkbox" checked={remember}
        onChange={event => setRemember(event.target.checked)} /> Manter conectado neste dispositivo</label>
        <p className="auth-help">O acesso salvo expira em até 7 dias. Depois, você entra novamente para proteger seus dados.</p></> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="btn btn-primary btn-full" disabled={busy}>{busy ? 'Criando...' : 'Criar meu espaço'} <ArrowRight size={17} /></button>
      <p className="form-hint"><ShieldCheck size={15} /> Seus dados ficam protegidos no seu espaço.</p>
    </form>
    {!google ? <GoogleSignInButton role="owner" remember={remember} onResult={applyGoogle} onError={setError} /> : null}
    <p className="auth-switch">Já tem uma conta? <Link to="/entrar">Entrar</Link></p>
  </AuthLayout>
}
