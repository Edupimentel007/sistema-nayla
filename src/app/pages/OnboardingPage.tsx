import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, CalendarDays, ChartNoAxesCombined, Check, MessageCircle, Moon, RefreshCw, ShieldCheck, Sparkles, Sun, UsersRound } from 'lucide-react'
import { api, type Subscription } from '../../lib/api'
import { useAuth, useTheme } from '../contexts'
import { Loading, Logo } from '../shared'
import './onboarding.css'

const features = [
  { icon: CalendarDays, title: 'Agenda e agendamento', description: 'Seu link mostra apenas seus serviços e horários disponíveis. Mudanças aparecem na agenda.' },
  { icon: UsersRound, title: 'Clientes em um lugar', description: 'Histórico de visitas, serviços e informações para atender cada cliente com cuidado.' },
  { icon: ChartNoAxesCombined, title: 'Finanças e análises', description: 'Faturamento, ticket médio, gráficos e dicas para entender o seu negócio.' },
  { icon: Sparkles, title: 'Nayla, sua assistente', description: 'Consulte sua agenda e seus resultados. Configure avisos e lembretes de atendimento.' },
]

function dateLabel(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(date)
}

function accessCopy(subscription: Subscription | null) {
  if (!subscription) return { title: 'Consultando acesso', detail: 'Aguarde enquanto verificamos sua conta.' }
  const endsAt = dateLabel(subscription.accessEndsAt || subscription.trialEndsAt || subscription.currentPeriodEnd)
  switch (subscription.manualAccessStatus) {
    case 'trial': return { title: 'Seus 30 dias de experiência estão ativos', detail: endsAt ? `Use todas as ferramentas até ${endsAt}. Para continuar depois, combine sua renovação diretamente com a equipe Nayla.` : 'Use todas as ferramentas durante o período liberado.' }
    case 'active': return { title: 'Seu acesso está ativo', detail: endsAt ? `Acesso liberado até ${endsAt}. A renovação é combinada diretamente com a equipe Nayla.` : 'Sua conta está liberada. A renovação é combinada diretamente com a equipe Nayla.' }
    case 'blocked': return { title: 'Seu acesso foi suspenso', detail: 'Entre em contato com a equipe Nayla para entender a situação da sua conta.' }
    case 'expired': return { title: 'Seu período de acesso terminou', detail: 'Se quiser continuar usando a Nayla, combine sua renovação diretamente com a equipe.' }
    default: return subscription.accessGranted
      ? { title: 'Seu acesso está ativo', detail: endsAt ? `Acesso liberado até ${endsAt}.` : 'Sua conta está liberada.' }
      : { title: 'Seu acesso aguarda liberação', detail: 'Sua conta foi criada. A equipe Nayla pode liberar seus 30 dias de experiência; você receberá acesso ao painel assim que isso acontecer.' }
  }
}

export function OnboardingPage() {
  const mainRef = useRef<HTMLElement>(null)
  const { session, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refresh = async () => {
    setError('')
    try { setSubscription(await api.subscription()) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível consultar seu acesso.') }
    finally { setLoading(false) }
  }
  useEffect(() => { void refresh() }, [])
  useEffect(() => {
    const main = mainRef.current
    if (!main || !('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const sections = main.querySelectorAll<HTMLElement>('.onboarding-section, .onboarding-help')
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        entry.target.classList.add('nayla-onboarding-visible')
        observer.unobserve(entry.target)
      }
    }, { threshold: .08, rootMargin: '0px 0px -30px 0px' })
    sections.forEach(section => { section.classList.add('nayla-onboarding-reveal'); observer.observe(section) })
    return () => observer.disconnect()
  }, [])

  const finish = async (destination = '/app') => {
    if (!subscription?.accessGranted) { setError('Seu acesso ainda não foi liberado. Atualize esta tela após a confirmação da equipe Nayla.'); return }
    setBusy(true); setError('')
    try { await api.completeOnboarding(); navigate(destination, { replace: true }) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível abrir seu painel.') }
    finally { setBusy(false) }
  }
  const signOut = async () => {
    setBusy(true)
    try { await logout(); navigate('/entrar', { replace: true }) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível sair agora.') }
    finally { setBusy(false) }
  }
  const copy = accessCopy(subscription)

  return <div className="onboarding-page">
    <header className="onboarding-header"><Logo small /><div><span>Seu começo na Nayla</span><button className="icon-button" type="button" onClick={toggleTheme} aria-label={theme === 'light' ? 'Ativar tema escuro' : 'Ativar tema claro'}>{theme === 'light' ? <Moon size={19} /> : <Sun size={19} />}</button></div></header>
    <main className="onboarding-main" ref={mainRef}>
      <section className="onboarding-intro" aria-labelledby="onboarding-title">
        <span className="eyebrow">BEM-VINDA AO SEU ESPAÇO</span>
        <h1 id="onboarding-title">Vamos organizar o seu trabalho, {session?.user.name.split(' ')[0]}.</h1>
        <p>Conheça as principais ferramentas da Nayla. Seu espaço já está criado e a equipe libera o acesso para você experimentar por 30 dias.</p>
      </section>
      <section className="trial-banner" aria-labelledby="access-banner-title">
        <div className="trial-banner-value"><span>EXPERIÊNCIA INICIAL</span><strong>30 dias</strong><small>liberados uma vez por profissional</small></div>
        <div className="trial-banner-copy"><span className="eyebrow">ACESSO CONTROLADO</span><h2 id="access-banner-title">{copy.title}</h2><p>{copy.detail}</p>
          {loading ? <Loading label="Verificando seu acesso..." /> : <div className="onboarding-exit">
            {subscription?.accessGranted ? <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void finish()}>{busy ? 'Abrindo...' : 'Conhecer meu painel'} <ArrowRight size={17} /></button> : null}
            <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => void refresh()}><RefreshCw size={16} /> Atualizar acesso</button>
          </div>}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
        </div>
      </section>
      <section aria-labelledby="onboarding-features-title" className="onboarding-section">
        <div className="onboarding-section-heading"><div><span className="eyebrow">01 / O QUE VOCÊ ENCONTRA</span><h2 id="onboarding-features-title">Tudo para cuidar do seu negócio</h2></div><span>Uma visão rápida antes de começar</span></div>
        <div className="onboarding-features">{features.map(({ icon: Icon, title, description }) => <article key={title} className="onboarding-feature"><Icon size={22} strokeWidth={1.8} aria-hidden="true" /><h3>{title}</h3><p>{description}</p></article>)}</div>
      </section>
      <section aria-labelledby="onboarding-access-title" className="onboarding-section">
        <div className="onboarding-section-heading"><div><span className="eyebrow">02 / SEU ACESSO</span><h2 id="onboarding-access-title">Tudo combinado diretamente com você</h2></div></div>
        <p className="onboarding-status"><ShieldCheck size={18} /> A Nayla não pede cartão no app e não faz cobranças automáticas. A liberação inicial e a renovação são feitas individualmente pela equipe Nayla.</p>
        {subscription?.accessGranted ? <p className="onboarding-status"><Check size={18} /> {copy.title}{dateLabel(subscription.accessEndsAt) ? ` · até ${dateLabel(subscription.accessEndsAt)}` : ''}</p> : null}
        <div className="onboarding-exit">
          {subscription?.accessGranted ? <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void finish()}>Ir para meu painel <ArrowRight size={17} /></button> : null}
          <button className="subtle-link" type="button" disabled={busy} onClick={() => void signOut()}>Sair desta conta</button>
        </div>
      </section>
      <aside className="onboarding-help"><MessageCircle size={19} /><p>Depois da liberação, você poderá ajustar serviços, horários, marca e avisos em <Link to="/app/configuracoes" onClick={event => { event.preventDefault(); void finish('/app/configuracoes') }}>Configurações</Link>.</p></aside>
    </main>
  </div>
}
