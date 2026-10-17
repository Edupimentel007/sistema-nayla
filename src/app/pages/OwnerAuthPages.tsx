import { useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, Check, ImageUp, Moon, ShieldCheck, Sun } from 'lucide-react'
import { api, type CatalogService, type CustomSignupService, type GoogleCompletion, type Session, type Specialty } from '../../lib/api'
import { uploadBusinessLogo, validateBusinessLogoFile } from '../../lib/businessLogo'
import { clearGoogleAppNonce, currentGoogleAppNonce, readGoogleErrorFromUrl, readGoogleTicketFromUrl } from '../../lib/googleAuth'
import { GoogleSignInButton } from '../GoogleSignInButton'
import { SignupServiceSelector, type CustomServiceDraft } from '../SignupServiceSelector'
import { SpecialtySelector } from '../SpecialtySelector'
import { useAuth, useTheme } from '../contexts'
import { Logo } from '../shared'
import './public-motion.css'
import './signup-logo.css'

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
  const [catalog, setCatalog] = useState<CatalogService[]>([])
  const [selectedServices, setSelectedServices] = useState<string[]>([])
  const [customServices, setCustomServices] = useState<CustomServiceDraft[]>([])
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState('')
  const [catalogRetry, setCatalogRetry] = useState(0)
  const [remember, setRemember] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState('')
  const [logoError, setLogoError] = useState('')
  const [createdSession, setCreatedSession] = useState<Session | null>(null)
  useEffect(() => {
    if (!logoFile) { setLogoPreview(''); return }
    const preview = URL.createObjectURL(logoFile)
    setLogoPreview(preview)
    return () => URL.revokeObjectURL(preview)
  }, [logoFile])
  useEffect(() => {
    let live = true
    setCatalogLoading(true)
    setCatalogError('')
    api.catalog().then(result => { if (live) setCatalog(result.services) })
      .catch(reason => { if (live) setCatalogError(reason instanceof Error ? reason.message : 'Não foi possível carregar o catálogo.') })
      .finally(() => { if (live) setCatalogLoading(false) })
    return () => { live = false }
  }, [catalogRetry])
  const toggleSpecialty = (item: Specialty) => {
    if (selected.includes(item)) {
      setSelected(current => current.filter(value => value !== item))
      setSelectedServices(current => current.filter(serviceId => catalog.find(service => service.id === serviceId)?.category !== item))
      setCustomServices(current => current.filter(service => service.category !== item))
    } else {
      setSelected(current => [...current, item])
      if (item === 'outros') setCustomServices(current => current.length >= 10 ? current :
        [...current, { name: '', category: item, price: '', durationMinutes: '60' }])
    }
  }
  const toggleService = (id: string) => setSelectedServices(current => current.includes(id)
    ? current.filter(value => value !== id) : [...current, id])
  const addCustomService = () => setCustomServices(current => current.length >= 10 ? current :
    [...current, { name: '', category: selected[0] ?? 'outros', price: '', durationMinutes: '60' }])
  const updateCustomService = (index: number, patch: Partial<CustomServiceDraft>) =>
    setCustomServices(current => current.map((service, position) => position === index ? { ...service, ...patch } : service))
  const removeCustomService = (index: number) =>
    setCustomServices(current => current.filter((_, position) => position !== index))
  const chooseLogo = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const validationError = validateBusinessLogoFile(file)
    setLogoError(validationError || '')
    setLogoFile(validationError ? null : file)
    if (createdSession) setError('')
  }
  const finishRegistration = async (session: Session) => {
    if (logoFile) {
      try {
        const { logoUrl } = await uploadBusinessLogo(logoFile)
        setSession({ ...session, business: { ...session.business, logoUrl } })
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : 'Tente enviar outra imagem.'
        setCreatedSession(session)
        setError(`Sua conta foi criada, mas a logo ainda não foi salva. ${message} Tente novamente ou continue sem logo.`)
        return
      }
    }
    navigate('/app', { replace: true })
  }
  const retryLogo = async () => {
    if (!createdSession || busy) return
    setBusy(true)
    setError('')
    try { await finishRegistration(createdSession) }
    finally { setBusy(false) }
  }
  const applyGoogle = (result: GoogleCompletion) => {
    if ('user' in result) { clearGoogleAppNonce(); setSession(result); navigate('/app', { replace: true }); return }
    const next = { ticket: result.googleTicket || '', email: result.email,
      name: result.name, passwordLinkRequired: result.passwordLinkRequired }
    if (next.passwordLinkRequired) navigate('/entrar', { state: { google: next }, replace: true })
    else { setGoogle(next); setEmail(next.email); setOwnerName(current => current || next.name) }
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError('')
    if (createdSession || busy) return
    if (!selected.length) { setError('Selecione pelo menos uma área de atuação.'); return }
    const filledCustom = customServices.filter(item => item.name.trim() || item.price.trim())
    const preparedCustom: CustomSignupService[] = []
    for (const item of filledCustom) {
      const name = item.name.trim()
      const price = Number(item.price)
      const durationMinutes = Number(item.durationMinutes)
      if (name.length < 2 || !item.price.trim() || !Number.isFinite(price) || price < 0 || price > 1_000_000 ||
        !Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 480 || !selected.includes(item.category)) {
        setError('Complete nome, área, preço e duração dos serviços adicionados.'); return
      }
      preparedCustom.push({ name, category: item.category, price, durationMinutes })
    }
    const serviceKey = (name: string, category: Specialty) => `${category}:${name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR')}`
    const customKeys = preparedCustom.map(item => serviceKey(item.name, item.category))
    if (new Set(customKeys).size !== customKeys.length || preparedCustom.some(item =>
      catalog.some(template => serviceKey(template.name, template.category) === serviceKey(item.name, item.category)))) {
      setError('Há serviços com o mesmo nome nessa área. Use um nome diferente.'); return
    }
    if (selected.some(item => item !== 'outros') && catalogLoading && !preparedCustom.length) { setError('Aguarde o catálogo de serviços carregar.'); return }
    if (selected.some(item => item !== 'outros') && catalogError && !preparedCustom.length) { setError('Carregue as opções de serviços antes de continuar.'); return }
    if (!selectedServices.length && !preparedCustom.length) { setError('Escolha ou adicione pelo menos um serviço que você oferece.'); return }
    if (!strongPassword(password)) { setError('Crie uma senha com pelo menos 12 caracteres, incluindo letras e números.'); return }
    setBusy(true)
    try {
      const details = { ownerName: ownerName.trim(), businessName: businessName.trim(),
        slug: slugify(slug), email: email.trim(), password, specialties: selected,
        selectedServices, customServices: preparedCustom, remember }
      const session = google
        ? await api.googleRegister('owner', google.ticket, details, currentGoogleAppNonce())
        : await api.register(details)
      clearGoogleAppNonce()
      setSession(session)
      await finishRegistration(session)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível criar sua conta.') }
    finally { setBusy(false) }
  }
  const logoPicker = <div className="signup-logo-field">
    <div className="signup-logo-preview">
      {logoPreview ? <img src={logoPreview} alt="Prévia da logo escolhida" />
        : <span aria-hidden="true">{businessName.trim().charAt(0).toLocaleUpperCase('pt-BR') || 'N'}</span>}
    </div>
    <div className="signup-logo-details">
      <strong>Logo do seu espaço <span>(opcional)</span></strong>
      <p>Ela aparecerá no seu perfil e no link de agendamento. Você também poderá trocar nas Configurações.</p>
      <div className="signup-logo-actions">
        <label className="btn btn-secondary signup-logo-button"><ImageUp size={17} /> {logoFile ? 'Trocar imagem' : 'Escolher imagem'}
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseLogo}
            aria-label="Escolher logo do espaço em PNG, JPEG ou WebP" disabled={busy} />
        </label>
        {logoFile ? <button type="button" className="subtle-link" disabled={busy}
          onClick={() => { setLogoFile(null); setLogoError('') }}>Remover seleção</button> : null}
      </div>
      <small>PNG, JPEG ou WebP · até 1 MB.</small>
      {logoError ? <p className="form-error" role="alert">{logoError}</p> : null}
    </div>
  </div>
  return <AuthLayout title={createdSession ? 'Seu espaço está pronto' : 'Crie seu espaço'}
    subtitle={createdSession ? 'Ajuste a logo ou siga para conhecer a Nayla.' : 'Informe seus dados e escolha as áreas e serviços que quer oferecer.'}>
    {!createdSession ? <div className="registration-trial"><span>SEU PRIMEIRO MÊS NA NAYLA</span><strong>30 dias grátis para testar</strong><p>Comece sem cartão. Após o teste, escolha um plano para continuar. Nenhuma cobrança será feita automaticamente.</p></div> : null}
    {google && !createdSession ? <p className="form-success"><Check size={16} /> Google confirmado para {google.email}. Complete seu espaço e escolha uma senha de recuperação.</p> : null}
    {createdSession ? <div className="signup-logo-retry">
      <p className="form-success" role="status"><Check size={16} /> Sua conta foi criada. Você pode tentar outra imagem ou continuar sem logo.</p>
      {logoPicker}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="signup-logo-retry-actions">
        <button className="btn btn-primary" type="button" disabled={busy || !logoFile || Boolean(logoError)}
          onClick={() => void retryLogo()}>{busy ? 'Salvando logo...' : 'Tentar salvar logo'}</button>
        <button className="btn btn-secondary" type="button" disabled={busy}
          onClick={() => navigate('/app', { replace: true })}>Continuar sem logo</button>
      </div>
    </div> : <form onSubmit={submit} className="form-stack">
      <div className="form-row"><label>Seu nome<input value={ownerName} onChange={event => setOwnerName(event.target.value)}
        placeholder="Como podemos chamar você?" autoComplete="name" required /></label>
        <label>Nome do seu espaço<input value={businessName} onChange={event => { setBusinessName(event.target.value); if (!slugEdited) setSlug(slugify(event.target.value)) }}
          placeholder="Ex.: Studio Maria" required /></label></div>
      <label>Seu link de agendamento<div className="input-prefix"><span>/agendar/</span><input value={slug}
        onChange={event => { setSlugEdited(true); setSlug(slugify(event.target.value)) }} placeholder="studio-maria" required /></div>
        <small className="auth-help">As clientes usarão este link para ver apenas os serviços do seu espaço.</small></label>
      {logoPicker}
      <label>E-mail<input type="email" value={email} onChange={event => setEmail(event.target.value)}
        placeholder="voce@exemplo.com" autoComplete="email" readOnly={Boolean(google)} required /></label>
      <label>Senha<input type="password" value={password} onChange={event => setPassword(event.target.value)}
        placeholder="12 ou mais caracteres" autoComplete="new-password" minLength={12} required />
        <small className="auth-help">Use 12 ou mais caracteres, com letras e números. Evite nomes, datas e senhas repetidas.</small></label>
      <SpecialtySelector selected={selected} onToggle={toggleSpecialty}
        hint="Você pode mudar suas áreas nas configurações e personalizar cada serviço e preço no seu catálogo." />
      <SignupServiceSelector areas={selected} services={catalog} selected={selectedServices}
        onToggle={toggleService} loading={catalogLoading} error={catalogError}
        onRetry={() => setCatalogRetry(value => value + 1)} customServices={customServices}
        onAddCustom={addCustomService} onUpdateCustom={updateCustomService} onRemoveCustom={removeCustomService} />
      {!google ? <><label className="remember-choice"><input type="checkbox" checked={remember}
        onChange={event => setRemember(event.target.checked)} /> Manter conectado neste dispositivo</label>
        <p className="auth-help">O acesso salvo expira em até 7 dias. Depois, você entra novamente para proteger seus dados.</p></> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="btn btn-primary btn-full" disabled={busy}>{busy ? 'Criando...' : 'Criar meu espaço'} <ArrowRight size={17} /></button>
      <p className="form-hint"><ShieldCheck size={15} /> Seus dados ficam protegidos no seu espaço.</p>
    </form>}
    {!google && !createdSession ? <GoogleSignInButton role="owner" remember={remember} onResult={applyGoogle} onError={setError} /> : null}
    {!createdSession ? <p className="auth-switch">Já tem uma conta? <Link to="/entrar">Entrar</Link></p> : null}
  </AuthLayout>
}
