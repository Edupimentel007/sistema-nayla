import { BrowserRouter, Link, NavLink, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useState, type FormEvent } from 'react'
import { ArrowRight, CalendarDays, ChartNoAxesCombined, Check, ChevronRight, ContactRound, Heart, LayoutDashboard, LogOut, Menu, Moon, Scissors, Settings2, ShieldCheck, Sparkles, Sun, Wallet, X } from 'lucide-react'
import { api, type Specialty } from '../lib/api'
import { AuthProvider, ThemeProvider, useAuth, useTheme } from './contexts'
import { Loading, Logo, specialties } from './shared'
import { DashboardPage } from './pages/DashboardPage'
import { AgendaPage } from './pages/AgendaPage'
import { ClientsPage } from './pages/ClientsPage'
import { FinancePage } from './pages/FinancePage'
import { ServicesPage } from './pages/ServicesPage'
import { SettingsPage } from './pages/SettingsPage'
import { AssistantPage } from './pages/AssistantPage'
import { BookingPage, ClientAppointmentsPage, ClientLoginPage } from './pages/PublicPages'

const navigation = [
  { path: '/app', label: 'Visão geral', icon: LayoutDashboard, end: true },
  { path: '/app/agenda', label: 'Agenda', icon: CalendarDays },
  { path: '/app/clientes', label: 'Clientes', icon: ContactRound },
  { path: '/app/financeiro', label: 'Financeiro', icon: Wallet },
  { path: '/app/servicos', label: 'Serviços', icon: Scissors },
  { path: '/app/assistente', label: 'Nayla IA', icon: Sparkles },
  { path: '/app/configuracoes', label: 'Configurações', icon: Settings2 },
]

function ThemeButton({ className = '' }: { className?: string }) {
  const { theme, toggleTheme } = useTheme()
  return <button className={`icon-button ${className}`} type="button" onClick={toggleTheme} title={theme === 'light' ? 'Ativar tema escuro' : 'Ativar tema claro'} aria-label={theme === 'light' ? 'Ativar tema escuro' : 'Ativar tema claro'}>{theme === 'light' ? <Moon size={19} /> : <Sun size={19} />}</button>
}

function RequireAuth() {
  const { session, loading } = useAuth()
  const location = useLocation()
  if (loading) return <main className="center-screen"><Logo /><Loading /></main>
  if (!session) return <Navigate to="/entrar" state={{ from: location.pathname }} replace />
  return <Outlet />
}

function AdminShell() {
  const { session, logout } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const navigate = useNavigate()
  if (!session) return null
  const bookingUrl = `/agendar/${session.business.slug}`
  const signOut = async () => { try { await logout(); navigate('/entrar') } catch { /* the page remains usable if logout fails */ } }
  return <div className="app-shell">
    <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
      <div className="sidebar-top"><Link to="/app" onClick={() => setMenuOpen(false)} aria-label="Início Nayla"><Logo /></Link><button className="icon-button close-mobile" onClick={() => setMenuOpen(false)} aria-label="Fechar menu"><X size={20} /></button></div>
      <div className="workspace-pill"><span className="workspace-avatar">{session.business.name.charAt(0).toUpperCase()}</span><span><strong>{session.business.name}</strong><small>Meu espaço</small></span></div>
      <div className="nav-label">MENU PRINCIPAL</div>
      <nav className="side-nav" aria-label="Menu principal">{navigation.map(({ path, label, icon: Icon, end }) => <NavLink key={path} to={path} end={end} onClick={() => setMenuOpen(false)} className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`}><Icon size={19} strokeWidth={1.9} /><span>{label}</span></NavLink>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-promo"><span className="promo-icon"><Heart size={18} fill="currentColor" /></span><strong>Seu espaço de agendamentos</strong><p>Compartilhe seu link e receba suas clientes com praticidade.</p><Link to={bookingUrl} target="_blank">Ver minha página <ArrowRight size={14} /></Link></div><button className="side-link signout" onClick={signOut}><LogOut size={19} /> Sair da conta</button></div>
    </aside>
    {menuOpen ? <button className="sidebar-scrim" aria-label="Fechar menu" onClick={() => setMenuOpen(false)} /> : null}
    <div className="app-main"><header className="topbar"><div className="topbar-left"><button className="icon-button menu-button" onClick={() => setMenuOpen(true)} aria-label="Abrir menu"><Menu size={22} /></button><span className="topbar-greeting">Olá, <strong>{session.user.name.split(' ')[0]}</strong> <span className="wave">✳</span></span></div><div className="topbar-right"><span className="today-tag"><CalendarDays size={16} /> {new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date())}</span><ThemeButton /><Link to="/app/configuracoes" className="header-avatar" title="Configurações">{session.user.name.charAt(0).toUpperCase()}</Link></div></header><main className="content"><Outlet /></main></div>
  </div>
}

function PublicHeader() {
  return <header className="public-header"><Link to="/" aria-label="Nayla"><Logo /></Link><div><ThemeButton /><Link to="/entrar" className="header-login">Entrar <ArrowRight size={16} /></Link></div></header>
}

function LandingPage() {
  return <div className="public-site"><PublicHeader /><main><section className="hero"><div className="hero-copy"><span className="hero-kicker"><Sparkles size={15} /> Feito para quem transforma cuidado em negócio</span><h1>Seu talento merece uma rotina mais <em>leve.</em></h1><p>A Nayla reúne agendamentos, clientes, finanças e uma assistente inteligente em um só lugar. Mais tempo para cuidar de quem confia em você.</p><div className="hero-buttons"><Link className="btn btn-primary btn-large" to="/cadastro">Criar minha conta <ArrowRight size={18} /></Link><Link className="btn btn-secondary btn-large" to="/entrar">Já tenho uma conta</Link></div><div className="hero-trust"><div className="avatar-stack"><span>✿</span><span>♡</span><span>✦</span></div><span>Seu negócio, do seu jeito.<br/><strong>Simples desde o primeiro clique.</strong></span></div></div><div className="hero-art" aria-hidden="true"><div className="art-orbit art-orbit-one" /><div className="art-orbit art-orbit-two" /><div className="floating-note note-one"><div className="note-icon"><CalendarDays size={18} /></div><div><strong>Agenda organizada</strong><small>Tudo no seu tempo</small></div><Check size={16} /></div><div className="mock-card"><div className="mock-top"><div><small>VISÃO GERAL</small><strong>Seu dia mais leve ✦</strong></div><span className="mock-dot">•••</span></div><div className="mock-revenue"><small>Faturamento do mês</small><strong>R$ 4.850,00</strong><span>Exemplo ilustrativo</span></div><div className="mock-grid"><div><span>♡</span><small>Clientes</small><strong>48</strong></div><div><span>✦</span><small>Atendimentos</small><strong>72</strong></div></div><div className="mock-upcoming"><span className="mock-line" /><div><strong>Próximo atendimento</strong><small>14:00 · Alongamento de unhas</small></div></div></div><div className="floating-note note-two"><div className="note-icon"><Sparkles size={18} /></div><div><strong>Nayla IA</strong><small>Sua assistente está aqui</small></div></div></div></section>
      <section className="features" id="recursos"><div className="section-intro"><span className="eyebrow">TUDO EM UM SÓ LUGAR</span><h2>O cuidado que você dedica às clientes, agora no seu negócio.</h2><p>Ferramentas práticas para manicures, designers de sobrancelhas e profissionais de cílios crescerem com clareza.</p></div><div className="feature-grid"><article className="feature-card"><span className="feature-icon pink"><CalendarDays size={25} /></span><h3>Agenda sem complicação</h3><p>Tenha seus horários organizados e ofereça às clientes uma página própria para agendar.</p><span>01 / Organização</span></article><article className="feature-card"><span className="feature-icon peach"><ChartNoAxesCombined size={25} /></span><h3>Seu negócio em números</h3><p>Acompanhe faturamento, ticket médio, clientes e resultados por período.</p><span>02 / Clareza</span></article><article className="feature-card"><span className="feature-icon lavender"><Sparkles size={25} /></span><h3>Nayla, sua assistente</h3><p>Pergunte sobre sua rotina e consulte informações do seu espaço em segundos.</p><span>03 / Apoio</span></article></div></section>
      <section className="cta-band"><div><span className="eyebrow">COMECE HOJE</span><h2>Um espaço lindo para o seu trabalho brilhar.</h2><p>Crie sua conta, personalize seus serviços e compartilhe seu link.</p></div><Link className="btn btn-white btn-large" to="/cadastro">Criar meu espaço <ArrowRight size={18} /></Link></section></main><footer className="site-footer"><Logo small /><span>Feito para quem cuida de pessoas. © {new Date().getFullYear()} Nayla.</span><Link to="/entrar">Entrar</Link></footer></div>
}

function AuthLayout({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle: string }) {
  return <div className="auth-page"><div className="auth-visual"><Link to="/"><Logo /></Link><div className="auth-visual-content"><span className="auth-decoration">✦</span><span className="eyebrow">BEM-VINDA À NAYLA</span><h2>Sua paixão merece um negócio que acompanha você.</h2><p>Uma rotina organizada deixa mais espaço para o que você faz de melhor.</p><div className="auth-benefits"><span><Check size={16} /> Agenda online personalizada</span><span><Check size={16} /> Gestão financeira clara</span><span><Check size={16} /> Nayla IA sempre por perto</span></div></div><small>Feito com carinho para profissionais de beleza ♡</small></div><div className="auth-main"><div className="auth-mobile-top"><Link to="/"><Logo small /></Link><ThemeButton /></div><div className="auth-card"><div className="auth-heading"><span className="eyebrow">SEU ESPAÇO COMEÇA AQUI</span><h1>{title}</h1><p>{subtitle}</p></div>{children}</div><div className="auth-foot"><ThemeButton /><span>© {new Date().getFullYear()} Nayla</span></div></div></div>
}

function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { setSession } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setError(''); try { setSession(await api.login(email.trim(), password)); navigate((location.state as { from?: string } | null)?.from || '/app', { replace: true }) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível entrar.') } finally { setBusy(false) } }
  return <AuthLayout title="Que bom ter você de volta!" subtitle="Entre para cuidar do seu negócio com mais leveza."><form onSubmit={submit} className="form-stack"><label>E-mail<input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="voce@exemplo.com" required /></label><label>Senha<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Sua senha" required /></label>{error ? <p className="form-error" role="alert">{error}</p> : null}<button className="btn btn-primary btn-full" disabled={busy}>{busy ? 'Entrando...' : 'Entrar na minha conta'} <ArrowRight size={17} /></button></form><p className="auth-switch">Ainda não tem conta? <Link to="/cadastro">Criar meu espaço</Link></p></AuthLayout>
}

const slugify = (text: string) => text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

function RegisterPage() {
  const navigate = useNavigate()
  const { setSession } = useAuth()
  const [ownerName, setOwnerName] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [selected, setSelected] = useState<Specialty[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const toggleSpecialty = (item: Specialty) => setSelected(current => current.includes(item) ? current.filter(value => value !== item) : [...current, item])
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!selected.length) { setError('Selecione pelo menos uma área de atuação.'); return } if (password.length < 8) { setError('A senha precisa ter pelo menos 8 caracteres.'); return } setBusy(true); setError(''); try { setSession(await api.register({ ownerName: ownerName.trim(), businessName: businessName.trim(), slug: slugify(slug), email: email.trim(), password, specialties: selected })); navigate('/app', { replace: true }) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível criar sua conta.') } finally { setBusy(false) } }
  return <AuthLayout title="Crie seu espaço" subtitle="Alguns dados e seu negócio já começa a ganhar forma."><form onSubmit={submit} className="form-stack"><div className="form-row"><label>Seu nome<input value={ownerName} onChange={e => setOwnerName(e.target.value)} placeholder="Como podemos chamar você?" autoComplete="name" required /></label><label>Nome do seu espaço<input value={businessName} onChange={e => { setBusinessName(e.target.value); if (!slugEdited) setSlug(slugify(e.target.value)) }} placeholder="Ex.: Studio Maria" required /></label></div><label>Seu link de agendamento<div className="input-prefix"><span>/agendar/</span><input value={slug} onChange={e => { setSlugEdited(true); setSlug(slugify(e.target.value)) }} placeholder="seu-espaco" required /></div></label><label>E-mail<input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="voce@exemplo.com" autoComplete="email" required /></label><label>Senha<input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="No mínimo 8 caracteres" autoComplete="new-password" minLength={8} required /></label><fieldset className="specialty-field"><legend>Quais serviços você oferece?</legend><div className="specialty-options">{(Object.keys(specialties) as Specialty[]).map(item => <button key={item} type="button" className={`specialty-choice ${selected.includes(item) ? 'selected' : ''}`} aria-pressed={selected.includes(item)} onClick={() => toggleSpecialty(item)}>{selected.includes(item) ? <Check size={15} /> : <span className="choice-circle" />}{specialties[item]}</button>)}</div></fieldset>{error ? <p className="form-error" role="alert">{error}</p> : null}<button className="btn btn-primary btn-full" disabled={busy}>{busy ? 'Criando seu espaço...' : 'Criar meu espaço'} <ArrowRight size={17} /></button><p className="form-hint"><ShieldCheck size={15} /> Seus dados ficam protegidos no seu espaço.</p></form><p className="auth-switch">Já tem uma conta? <Link to="/entrar">Entrar</Link></p></AuthLayout>
}

function NotFoundPage() { return <div className="not-found"><span>404</span><h1>Essa página não foi encontrada.</h1><p>Vamos voltar para um lugar conhecido?</p><Link className="btn btn-primary" to="/">Voltar ao início <ChevronRight size={17} /></Link></div> }

export function App() {
  return <ThemeProvider><AuthProvider><BrowserRouter><Routes><Route path="/" element={<LandingPage />} /><Route path="/entrar" element={<LoginPage />} /><Route path="/cadastro" element={<RegisterPage />} /><Route element={<RequireAuth />}><Route path="/app" element={<AdminShell />}><Route index element={<DashboardPage />} /><Route path="agenda" element={<AgendaPage />} /><Route path="clientes" element={<ClientsPage />} /><Route path="financeiro" element={<FinancePage />} /><Route path="servicos" element={<ServicesPage />} /><Route path="assistente" element={<AssistantPage />} /><Route path="configuracoes" element={<SettingsPage />} /></Route></Route><Route path="/agendar/:slug" element={<BookingPage />} /><Route path="/agendar/:slug/entrar" element={<ClientLoginPage />} /><Route path="/agendar/:slug/meus-agendamentos" element={<ClientAppointmentsPage />} /><Route path="*" element={<NotFoundPage />} /></Routes></BrowserRouter></AuthProvider></ThemeProvider>
}
