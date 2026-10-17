import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { Browser } from '@capacitor/browser'
import { ArrowRight, CalendarDays, ChartNoAxesCombined, Check, CreditCard, LockKeyhole, MessageCircle, Moon, QrCode, RefreshCw, Sparkles, Sun, UsersRound } from 'lucide-react'
import { api, type BillingCheckout, type BillingMethod, type BillingPlan, type Subscription } from '../../lib/api'
import { useAuth, useTheme } from '../contexts'
import { Loading, Logo } from '../shared'
import './onboarding.css'

const features = [
  { icon: CalendarDays, title: 'Agenda e agendamento', description: 'Seu link mostra apenas seus serviços e horários disponíveis. Mudanças aparecem na agenda.' },
  { icon: UsersRound, title: 'Clientes em um lugar', description: 'Histórico de visitas, serviços e informações para atender cada cliente com cuidado.' },
  { icon: ChartNoAxesCombined, title: 'Finanças e análises', description: 'Faturamento, ticket médio, gráficos e dicas para entender o seu negócio.' },
  { icon: Sparkles, title: 'Nayla, sua assistente', description: 'Consulte sua agenda e seus resultados. Configure avisos e lembretes de atendimento.' },
]

const plans: Array<{ id: BillingPlan; title: string; price: string; unit: string; detail: string; cardDetail: string }> = [
  { id: 'monthly', title: 'Mensal', price: 'R$ 49,90', unit: '/ mês', detail: 'Pagamento avulso. Você renova quando desejar.', cardDetail: 'Cartão ou Pix: R$ 49,90 por período.' },
  { id: 'annual', title: 'Anual', price: 'R$ 420', unit: '/ ano', detail: 'Equivale a R$ 35 por mês. Pix à vista.', cardDetail: 'Cartão: 12x de R$ 35 sem juros após habilitar essa condição no Mercado Pago.' },
]

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Não foi possível concluir esta ação. Tente novamente.'
}

function validCpfCnpj(value: string) {
  const digits = value.replace(/\D/g, '')
  if (!/^(\d{11}|\d{14})$/.test(digits) || /^(\d)\1+$/.test(digits)) return false
  if (digits.length === 11) {
    for (let length = 9; length <= 10; length++) {
      const sum = [...digits.slice(0, length)].reduce((total, digit, index) => total + Number(digit) * (length + 1 - index), 0)
      const check = ((sum * 10) % 11) % 10
      if (check !== Number(digits[length])) return false
    }
    return true
  }
  for (let length = 12; length <= 13; length++) {
    let weight = length === 12 ? 5 : 6
    const sum = [...digits.slice(0, length)].reduce((total, digit) => {
      const next = total + Number(digit) * weight
      weight = weight === 2 ? 9 : weight - 1
      return next
    }, 0)
    const check = sum % 11 < 2 ? 0 : 11 - sum % 11
    if (check !== Number(digits[length])) return false
  }
  return true
}

function qrImage(encodedImage: string) {
  const image = encodedImage.startsWith('data:image/png;base64,')
    ? encodedImage.slice('data:image/png;base64,'.length) : encodedImage
  return image.length <= 1_500_000 && /^[A-Za-z0-9+/]+={0,2}$/.test(image)
    ? `data:image/png;base64,${image}` : null
}

function dateLabel(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(date)
}

async function openTrustedCheckout(url: string) {
  const destination = new URL(url)
  const trustedHosts = new Set(['www.mercadopago.com.br', 'mercadopago.com.br',
    'sandbox.mercadopago.com.br', 'www.mercadopago.com', 'mercadopago.com',
    'sandbox.mercadopago.com'])
  const checkoutPath = destination.pathname.startsWith('/checkout/') ||
    /^\/[a-z]{3}\/checkout\//.test(destination.pathname) ||
    destination.pathname === '/subscriptions/checkout'
  if (destination.protocol !== 'https:' || !trustedHosts.has(destination.hostname) ||
      !checkoutPath || destination.username || destination.password)
    throw new Error('O link de pagamento não corresponde ao checkout seguro configurado.')
  if (Capacitor.isNativePlatform()) await Browser.open({ url: destination.href })
  else window.location.assign(destination.href)
}

export function OnboardingPage() {
  const native = Capacitor.isNativePlatform()
  const { session } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [plan, setPlan] = useState<BillingPlan>('annual')
  const [method, setMethod] = useState<BillingMethod>('card')
  const [cpfCnpj, setCpfCnpj] = useState('')
  const [checkout, setCheckout] = useState<BillingCheckout | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const refresh = async () => {
    setError('')
    try {
      const next = await api.subscription()
      setSubscription(next)
      if (next.plan) setPlan(next.plan)
    } catch (reason) { setError(errorText(reason)) }
    finally { setLoading(false) }
  }
  useEffect(() => { void refresh() }, [])

  const finish = async (destination = '/app') => {
    if (!subscription?.accessGranted) {
      setError('Seu acesso ainda não está ativo. Conclua a contratação e atualize o status para continuar.'); return
    }
    setBusy(true); setError('')
    try {
      await api.completeOnboarding()
      navigate(destination, { replace: true })
    } catch (reason) { setError(errorText(reason)) }
    finally { setBusy(false) }
  }
  const beginTrial = async () => {
    setBusy(true); setError('')
    try { setSubscription(await api.startTrial()) }
    catch (reason) { setError(errorText(reason)) }
    finally { setBusy(false) }
  }
  const beginCheckout = async () => {
    if (method === 'pix' && !validCpfCnpj(cpfCnpj)) {
      setError('Informe um CPF ou CNPJ válido para gerar o Pix.'); return
    }
    setBusy(true); setError(''); setCopied(false); setCheckout(null)
    try {
      const next = await api.billingCheckout(plan, method, method === 'pix' ? cpfCnpj.replace(/\D/g, '') : undefined)
      setCheckout(next)
      if (next.checkoutUrl && method === 'card') await openTrustedCheckout(next.checkoutUrl)
      else if (method === 'card') throw new Error('O checkout do cartão ainda não está disponível. Tente novamente em instantes.')
      else if (method === 'pix' && !next.pix) throw new Error('O código Pix ainda não está disponível. Tente novamente em instantes.')
      await refresh()
    } catch (reason) { setError(errorText(reason)) }
    finally { setBusy(false) }
  }
  const copyPix = async () => {
    if (!checkout?.pix?.payload) return
    try { await navigator.clipboard.writeText(checkout.pix.payload); setCopied(true) }
    catch { setError('Não foi possível copiar automaticamente. Selecione o código abaixo para copiar.') }
  }
  const selectPlan = (next: BillingPlan) => { setPlan(next); setCheckout(null); setError('') }
  const selectMethod = (next: BillingMethod) => { setMethod(next); setCheckout(null); setError('') }
  const image = checkout?.pix ? qrImage(checkout.pix.encodedImage) : null
  const trialActive = Boolean(subscription?.trialEndsAt &&
    Date.parse(subscription.trialEndsAt) > Date.now() && subscription.status !== 'active')
  const trialExpired = Boolean(subscription?.trialEndsAt &&
    Date.parse(subscription.trialEndsAt) <= Date.now() && subscription.status !== 'active')

  return <div className="onboarding-page">
    <header className="onboarding-header"><Logo small /><div><span>Seu começo na Nayla</span><button className="icon-button" type="button" onClick={toggleTheme} aria-label={theme === 'light' ? 'Ativar tema escuro' : 'Ativar tema claro'}>{theme === 'light' ? <Moon size={19} /> : <Sun size={19} />}</button></div></header>
    <main className="onboarding-main">
      <section className="onboarding-intro" aria-labelledby="onboarding-title">
        <span className="eyebrow">BEM-VINDA AO SEU ESPAÇO</span>
        <h1 id="onboarding-title">Vamos organizar o seu trabalho, {session?.user.name.split(' ')[0]}.</h1>
        <p>Conheça as ferramentas e comece seus 30 dias gratuitos. Seu espaço já está pronto para ser personalizado; depois do teste, você escolhe o plano que combina com sua rotina.</p>
      </section>
      {!loading && subscription?.status !== 'active' && (subscription?.trialAvailable || trialActive || trialExpired) ? <section className="trial-banner" aria-labelledby="trial-banner-title">
        <div className="trial-banner-value"><span>PRIMEIRO MÊS</span><strong>R$ 0</strong><small>30 dias de acesso</small></div>
        <div className="trial-banner-copy"><span className="eyebrow">UM COMEÇO SEM CUSTO</span>
          <h2 id="trial-banner-title">{trialActive ? 'Seu teste já começou.' : trialExpired ? 'Seu mês de teste terminou.' : 'Teste a Nayla por 30 dias grátis.'}</h2>
          <p>{trialActive ? `Você tem ${subscription?.trialDaysRemaining ?? 0} ${subscription?.trialDaysRemaining === 1 ? 'dia' : 'dias'} de acesso para usar agenda, clientes, finanças e a assistente Nayla. Depois você escolhe se deseja assinar.` :
            trialExpired ? 'Escolha um dos planos abaixo para continuar usando seu espaço.' :
              'Experimente todas as ferramentas no seu dia a dia. Sem cartão para começar e sem cobrança automática ao terminar o teste.'}</p>
          {subscription?.trialAvailable ? <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void beginTrial()}>{busy ? 'Iniciando teste...' : 'Começar meus 30 dias grátis'} <ArrowRight size={17} /></button> : null}
          {trialActive ? <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void finish()}>{busy ? 'Abrindo...' : 'Conhecer meu painel'} <ArrowRight size={17} /></button> : null}
          {error && (subscription?.trialAvailable || trialActive) ? <p className="form-error" role="alert">{error}</p> : null}
        </div>
      </section> : null}
      <section aria-labelledby="onboarding-features-title" className="onboarding-section">
        <div className="onboarding-section-heading"><div><span className="eyebrow">01 / O QUE VOCÊ ENCONTRA</span><h2 id="onboarding-features-title">Tudo para cuidar do seu negócio</h2></div><span>Uma visão rápida antes de começar</span></div>
        <div className="onboarding-features">{features.map(({ icon: Icon, title, description }) => <article key={title} className="onboarding-feature"><Icon size={22} strokeWidth={1.8} aria-hidden="true" /><h3>{title}</h3><p>{description}</p></article>)}</div>
      </section>
      <section aria-labelledby="onboarding-plans-title" className="onboarding-section">
        <div className="onboarding-section-heading"><div><span className="eyebrow">{native ? '02 / SEU ACESSO' : '02 / PLANOS DEPOIS DO TESTE'}</span><h2 id="onboarding-plans-title">{native ? 'Seu espaço está preparado' : 'Primeiro mês grátis. Depois, você decide.'}</h2></div><span>{native ? 'Acompanhe o estado da sua conta' : 'Mesmas ferramentas nos dois planos'}</span></div>
        {loading ? <Loading label="Consultando sua assinatura..." /> : native ? <>
          {subscription?.status === 'active' ? <p className="onboarding-status"><Check size={17} /> Seu acesso está ativo{dateLabel(subscription.currentPeriodEnd) ? ` até ${dateLabel(subscription.currentPeriodEnd)}` : ''}.</p> :
            subscription?.trialEndsAt && subscription.accessGranted ? <p className="onboarding-status">Seu teste gratuito vai até {dateLabel(subscription.trialEndsAt)}.</p> :
              <p className="onboarding-status">Seu acesso ainda não está ativo. Atualize esta tela após a ativação da sua conta.</p>}
          <div className="onboarding-exit"><button className="btn btn-primary" type="button" disabled={busy || !subscription?.accessGranted} onClick={() => void finish()}>Conhecer meu painel <ArrowRight size={17} /></button>
            <button className="subtle-link" type="button" disabled={busy} onClick={() => void refresh()}><RefreshCw size={15} /> Atualizar acesso</button></div>
          {error && !subscription?.trialAvailable && !trialActive ? <p className="form-error" role="alert">{error}</p> : null}
        </> : <>
          {trialActive ? <p className="onboarding-status"><Check size={17} /> Seu mês gratuito vai até {dateLabel(subscription?.trialEndsAt || undefined)}. A Nayla não fará uma cobrança automática.</p> : null}
          {subscription?.status === 'active' ? <p className="onboarding-status"><Check size={17} /> Seu plano {subscription.plan === 'annual' ? 'anual' : 'mensal'} está ativo{dateLabel(subscription.currentPeriodEnd) ? ` até ${dateLabel(subscription.currentPeriodEnd)}` : ''}.</p> : null}
          {subscription?.status === 'pending' ? <p className="onboarding-status">Seu pagamento está pendente de confirmação. Você pode verificar o status abaixo.</p> : null}
          <div className="onboarding-plans" role="group" aria-label="Planos Nayla">{plans.map(item => <button key={item.id} type="button" className={`onboarding-plan ${plan === item.id ? 'selected' : ''}`} aria-pressed={plan === item.id} onClick={() => selectPlan(item.id)}>
            <span className="onboarding-plan-head"><strong>{item.title}</strong><span aria-hidden="true" className="onboarding-radio">{plan === item.id ? <Check size={13} /> : null}</span></span>
            <span className="onboarding-price"><strong>{item.price}</strong><small>{item.unit}</small></span>
            <span className="onboarding-plan-detail">{item.detail}</span><span className="onboarding-plan-card">{item.cardDetail}</span>
          </button>)}</div>
          {(subscription?.trialAvailable || trialActive) ? <p className="onboarding-plan-timing">Esses valores só serão cobrados se você escolher um plano. O teste termina sem renovação automática.</p> : null}
          {subscription?.status !== 'active' && !subscription?.trialAvailable && !trialActive ? <div className="onboarding-payment">
            <div><h3>Como deseja pagar?</h3><p>O pagamento acontece em uma etapa segura. A Nayla não solicita dados do seu cartão aqui.</p></div>
            {!subscription?.providerConfigured ? <p className="onboarding-provider-note" role="status">Os pagamentos reais serão habilitados quando a integração de cobrança da Nayla estiver conectada pelo administrador.</p> : null}
            <div className="onboarding-methods" role="group" aria-label="Forma de pagamento">
              <button type="button" className={method === 'card' ? 'selected' : ''} aria-pressed={method === 'card'} onClick={() => selectMethod('card')}><CreditCard size={19} /> Checkout Mercado Pago (cartão)</button>
              <button type="button" className={method === 'pix' ? 'selected' : ''} aria-pressed={method === 'pix'} onClick={() => selectMethod('pix')}><QrCode size={19} /> Pix</button>
            </div>
            {method === 'pix' ? <label className="onboarding-tax-id">CPF ou CNPJ do pagador
              <input type="text" inputMode="numeric" autoComplete="off" value={cpfCnpj} maxLength={18}
                onChange={event => setCpfCnpj(event.target.value.replace(/[^\d.\-/]/g, ''))} placeholder="Digite apenas os números" />
              <small>Usado somente para criar a cobrança Pix; não fica salvo na Nayla.</small>
            </label> : null}
            <button className="btn btn-primary onboarding-pay-button" type="button" disabled={busy || !subscription?.providerConfigured} onClick={() => void beginCheckout()}>{busy ? 'Preparando pagamento...' : method === 'card' ? 'Ir para pagamento seguro' : 'Gerar Pix'} <ArrowRight size={17} /></button>
            <p className="onboarding-secure"><LockKeyhole size={15} /> O cartão é preenchido no checkout do provedor de pagamentos. A ativação ocorre somente após a confirmação do pagamento.</p>
          </div> : null}
          {checkout?.pix ? <div className="onboarding-pix" aria-live="polite"><div><span className="eyebrow">PIX GERADO</span><h3>Escaneie o QR Code ou copie o código</h3><p>Confira o valor e o destinatário na página do seu banco antes de confirmar.</p>{dateLabel(checkout.pix.expiresAt) ? <small>Válido até {new Date(checkout.pix.expiresAt!).toLocaleString('pt-BR')}</small> : null}</div>
            {image ? <img src={image} alt="QR Code dinâmico para pagamento Pix" /> : null}
            <label>Código Pix copia e cola<textarea readOnly value={checkout.pix.payload} rows={3} onFocus={event => event.currentTarget.select()} /></label>
            <button className="btn btn-secondary" type="button" onClick={() => void copyPix()}>{copied ? 'Código copiado' : 'Copiar código Pix'}</button>
          </div> : null}
          <div className="onboarding-exit">
            <button className="btn btn-secondary" type="button" disabled={busy || !subscription?.accessGranted} onClick={() => void finish()}>Conhecer meu painel <ArrowRight size={17} /></button>
            <button className="subtle-link" type="button" disabled={busy} onClick={() => void refresh()}><RefreshCw size={15} /> Verificar pagamento</button>
          </div>
          {error && !subscription?.trialAvailable && !trialActive ? <p className="form-error" role="alert">{error}</p> : null}
        </>}
      </section>
      <aside className="onboarding-help"><MessageCircle size={19} /><p>Depois, você pode ajustar serviços, horários, sua marca e os avisos em <Link to="/app/configuracoes" onClick={event => { event.preventDefault(); void finish('/app/configuracoes') }}>Configurações</Link>.</p></aside>
    </main>
  </div>
}
