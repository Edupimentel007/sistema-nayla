import { BrowserRouter, HashRouter, Link, NavLink, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { lazy, Suspense, useState } from 'react'
import { ArrowRight, CalendarDays, ChartNoAxesCombined, Check, ChevronRight, ContactRound, CreditCard, Heart, LayoutDashboard, LogOut, Menu, Moon, Scissors, Settings2, Sparkles, Sun, Wallet, X } from 'lucide-react'
import { AuthProvider, ThemeProvider, useAuth, useTheme } from './contexts'
import { Loading, Logo } from './shared'
import { BusinessLogo } from './BusinessLogo'
import { OnboardingGate } from './OnboardingGate'
import { OwnerInboxButton } from './InboxNotifications'

const DashboardPage = lazy(() => import('./pages/DashboardPage').then(module => ({ default: module.DashboardPage })))
const AgendaPage = lazy(() => import('./pages/AgendaPage').then(module => ({ default: module.AgendaPage })))
const ClientsPage = lazy(() => import('./pages/ClientsPage').then(module => ({ default: module.ClientsPage })))
const FinancePage = lazy(() => import('./pages/FinancePage').then(module => ({ default: module.FinancePage })))
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage').then(module => ({ default: module.AnalyticsPage })))
const ServicesPage = lazy(() => import('./pages/ServicesPage').then(module => ({ default: module.ServicesPage })))
const AssistantPage = lazy(() => import('./pages/AssistantPage').then(module => ({ default: module.AssistantPage })))
const SettingsPage = lazy(() => import('./pages/SettingsPage').then(module => ({ default: module.SettingsPage })))
const OwnerLoginPage = lazy(() => import('./pages/OwnerAuthPages').then(module => ({ default: module.OwnerLoginPage })))
const OwnerRegisterPage = lazy(() => import('./pages/OwnerAuthPages').then(module => ({ default: module.OwnerRegisterPage })))
const BookingPage = lazy(() => import('./pages/PublicPages').then(module => ({ default: module.BookingPage })))
const ClientLoginPage = lazy(() => import('./pages/PublicPages').then(module => ({ default: module.ClientLoginPage })))
const ClientAppointmentsPage = lazy(() => import('./pages/PublicPages').then(module => ({ default: module.ClientAppointmentsPage })))
const OnboardingPage = lazy(() => import('./pages/OnboardingPage').then(module => ({ default: module.OnboardingPage })))

const navigation = [
  { path: '/app', label: 'Visão geral', icon: LayoutDashboard, end: true },
  { path: '/app/agenda', label: 'Agenda', icon: CalendarDays },
  { path: '/app/clientes', label: 'Clientes', icon: ContactRound },
  { path: '/app/financeiro', label: 'Financeiro', icon: Wallet },
  { path: '/app/analises', label: 'Análises', icon: ChartNoAxesCombined },
  { path: '/app/servicos', label: 'Serviços', icon: Scissors },
  { path: '/app/assistente', label: 'Nayla IA', icon: Sparkles },
  { path: '/app/boas-vindas', label: 'Plano e cobrança', icon: CreditCard },
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
      <div className="workspace-pill"><BusinessLogo name={session.business.name} logoUrl={session.business.logoUrl} className="business-logo-sidebar" /><span><strong>{session.business.name}</strong><small>Meu espaço</small></span></div>
      <div className="nav-label">MENU PRINCIPAL</div>
      <nav className="side-nav" aria-label="Menu principal">{navigation.map(({ path, label, icon: Icon, end }) => <NavLink key={path} to={path} end={end} onClick={() => setMenuOpen(false)} className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`}><Icon size={19} strokeWidth={1.9} /><span>{label}</span></NavLink>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-promo"><span className="promo-icon"><Heart size={18} fill="currentColor" /></span><strong>Seu espaço de agendamentos</strong><p>Compartilhe seu link e receba suas clientes com praticidade.</p><Link to={bookingUrl} target={Capacitor.isNativePlatform() ? undefined : '_blank'}>Ver minha página <ArrowRight size={14} /></Link></div><button className="side-link signout" onClick={signOut}><LogOut size={19} /> Sair da conta</button></div>
    </aside>
    {menuOpen ? <button className="sidebar-scrim" aria-label="Fechar menu" onClick={() => setMenuOpen(false)} /> : null}
    <div className="app-main"><header className="topbar"><div className="topbar-left"><button className="icon-button menu-button" onClick={() => setMenuOpen(true)} aria-label="Abrir menu"><Menu size={22} /></button><span className="topbar-greeting">Olá, <strong>{session.user.name.split(' ')[0]}</strong></span></div><div className="topbar-right"><span className="today-tag"><CalendarDays size={16} /> {new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date())}</span><OwnerInboxButton /><ThemeButton /><Link to="/app/configuracoes" className="header-avatar" title="Configurações">{session.user.name.charAt(0).toUpperCase()}</Link></div></header><main className="content"><Suspense fallback={<Loading label="Abrindo página..." />}><Outlet /></Suspense></main></div>
  </div>
}

function PublicHeader() {
  return <header className="public-header"><Link to="/" aria-label="Nayla"><Logo /></Link><div><ThemeButton /><Link to="/entrar" className="header-login">Entrar <ArrowRight size={16} /></Link></div></header>
}

function TrialSpotlight() {
  return <section className="trial-spotlight" aria-label="Primeiro mês gratuito">
    <div><strong>30 dias grátis</strong><span>Teste a Nayla sem cartão. Depois você escolhe se quer assinar; não há cobrança automática.</span></div>
    <Link to="/cadastro">Começar meu teste <ArrowRight size={16} /></Link>
  </section>
}

function LandingPage() {
  return <div className="public-site"><PublicHeader /><main><TrialSpotlight /><section className="hero"><div className="hero-copy"><span className="hero-kicker"><Sparkles size={15} /> Feito para quem transforma cuidado em negócio</span><h1>Seu talento merece uma rotina mais <em>leve.</em></h1><p>A Nayla reúne agendamentos, clientes, finanças e uma assistente inteligente em um só lugar. Mais tempo para cuidar de quem confia em você.</p><div className="hero-buttons"><Link className="btn btn-primary btn-large" to="/cadastro">Criar minha conta <ArrowRight size={18} /></Link><Link className="btn btn-secondary btn-large" to="/entrar">Já tenho uma conta</Link></div><div className="hero-trust"><span>Seu negócio, do seu jeito.<br/><strong>Simples desde o primeiro clique.</strong></span></div></div><div className="hero-art" aria-hidden="true"><div className="art-orbit art-orbit-one" /><div className="art-orbit art-orbit-two" /><div className="floating-note note-one"><div className="note-icon"><CalendarDays size={18} /></div><div><strong>Agenda organizada</strong><small>Tudo no seu tempo</small></div><Check size={16} /></div><div className="mock-card"><div className="mock-top"><div><small>VISÃO GERAL</small><strong>Seu dia em ordem</strong></div><span className="mock-dot">•••</span></div><div className="mock-revenue"><small>Faturamento do mês</small><strong>R$ 4.850,00</strong><span>Exemplo ilustrativo</span></div><div className="mock-grid"><div><ContactRound size={16} /><small>Clientes</small><strong>48</strong></div><div><CalendarDays size={16} /><small>Atendimentos</small><strong>72</strong></div></div><div className="mock-upcoming"><span className="mock-line" /><div><strong>Próximo atendimento</strong><small>14:00 · Alongamento de unhas</small></div></div></div><div className="floating-note note-two"><div className="note-icon"><Sparkles size={18} /></div><div><strong>Nayla IA</strong><small>Sua assistente está aqui</small></div></div></div></section>
      <section className="features" id="recursos"><div className="section-intro"><span className="eyebrow">TUDO EM UM SÓ LUGAR</span><h2>O cuidado que você dedica às clientes, agora no seu negócio.</h2><p>Ferramentas práticas para profissionais de beleza organizarem o atendimento e crescerem com clareza.</p></div><div className="feature-grid"><article className="feature-card"><span className="feature-icon pink"><CalendarDays size={25} /></span><h3>Agenda sem complicação</h3><p>Tenha seus horários organizados e ofereça às clientes uma página própria para agendar.</p><span>01 / Organização</span></article><article className="feature-card"><span className="feature-icon peach"><ChartNoAxesCombined size={25} /></span><h3>Seu negócio em números</h3><p>Acompanhe faturamento, ticket médio, clientes e resultados por período.</p><span>02 / Clareza</span></article><article className="feature-card"><span className="feature-icon lavender"><Sparkles size={25} /></span><h3>Nayla, sua assistente</h3><p>Pergunte sobre sua rotina e consulte informações do seu espaço em segundos.</p><span>03 / Apoio</span></article></div></section>
      <section className="cta-band"><div><span className="eyebrow">COMECE HOJE</span><h2>Um espaço lindo para o seu trabalho brilhar.</h2><p>Teste por 30 dias grátis, escolha seus serviços e compartilhe seu link.</p></div><Link className="btn btn-white btn-large" to="/cadastro">Criar meu espaço <ArrowRight size={18} /></Link></section></main><footer className="site-footer"><Logo small /><span>Feito para quem cuida de pessoas. © {new Date().getFullYear()} Nayla.</span><Link to="/entrar">Entrar</Link></footer></div>
}

function NotFoundPage() { return <div className="not-found"><span>404</span><h1>Essa página não foi encontrada.</h1><p>Vamos voltar para um lugar conhecido?</p><Link className="btn btn-primary" to="/">Voltar ao início <ChevronRight size={17} /></Link></div> }

export function App() {
  const Router = Capacitor.isNativePlatform() ? HashRouter : BrowserRouter
  return <ThemeProvider><AuthProvider><Router><Suspense fallback={<main className="center-screen"><Loading label="Abrindo Nayla..." /></main>}><Routes><Route path="/" element={<LandingPage />} /><Route path="/entrar" element={<OwnerLoginPage />} /><Route path="/cadastro" element={<OwnerRegisterPage />} /><Route element={<RequireAuth />}><Route path="/app/boas-vindas" element={<OnboardingPage />} /><Route path="/app" element={<OnboardingGate><AdminShell /></OnboardingGate>}><Route index element={<DashboardPage />} /><Route path="agenda" element={<AgendaPage />} /><Route path="clientes" element={<ClientsPage />} /><Route path="financeiro" element={<FinancePage />} /><Route path="analises" element={<AnalyticsPage />} /><Route path="servicos" element={<ServicesPage />} /><Route path="assistente" element={<AssistantPage />} /><Route path="configuracoes" element={<SettingsPage />} /></Route></Route><Route path="/agendar/:slug" element={<BookingPage />} /><Route path="/agendar/:slug/entrar" element={<ClientLoginPage />} /><Route path="/agendar/:slug/meus-agendamentos" element={<ClientAppointmentsPage />} /><Route path="*" element={<NotFoundPage />} /></Routes></Suspense></Router></AuthProvider></ThemeProvider>
}
