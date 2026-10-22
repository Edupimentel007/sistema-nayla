import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { ArrowLeft, ArrowRight, CalendarDays, Check, History, LockKeyhole, LogOut, Mail, Moon, Phone, RefreshCw, Search, ShieldCheck, Sun, UserRoundX } from 'lucide-react'
import { api, type AccessAuditItem, type ProfessionalAccess, type ProfessionalsPage } from '../../lib/api'
import { useAuth, useTheme } from '../contexts'
import { Loading, Logo } from '../shared'
import './super-admin.css'

const pageSize = 20

const statusLabel: Record<ProfessionalAccess['manualAccessStatus'], string> = {
  pending: 'Aguardando liberação',
  trial: 'Experiência ativa',
  active: 'Acesso ativo',
  expired: 'Acesso encerrado',
  blocked: 'Bloqueada',
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(date)
}

function formatDateTime(value: string) {
  const date = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

const auditLabel: Record<string, string> = {
  trial_granted: 'Experiência inicial liberada',
  access_granted: 'Acesso renovado',
  access_extended: 'Prazo ampliado',
  access_blocked: 'Acesso bloqueado',
}

export function SuperAdminPage() {
  const { session, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [pageData, setPageData] = useState<ProfessionalsPage | null>(null)
  const [queryDraft, setQueryDraft] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null)
  const [historyFor, setHistoryFor] = useState<string | null>(null)
  const [history, setHistory] = useState<AccessAuditItem[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const historyRequest = useRef(0)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let live = true
    api.adminMe().then(result => { if (live) setAllowed(result.isSuperAdmin) })
      .catch(() => { if (live) setAllowed(false) })
    return () => { live = false }
  }, [])

  useEffect(() => {
    if (!allowed) return
    let live = true
    setLoading(true)
    setError('')
    setPageData(null)
    api.professionals(query, page, pageSize).then(result => { if (live) setPageData(result) })
      .catch(reason => { if (live) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar as profissionais.') })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [allowed, query, page, reload])

  const counts = useMemo(() => {
    const items = pageData?.items || []
    return {
      pending: items.filter(item => item.manualAccessStatus === 'pending').length,
      granted: items.filter(item => ['trial', 'active'].includes(item.manualAccessStatus)).length,
      attention: items.filter(item => ['expired', 'blocked'].includes(item.manualAccessStatus)).length,
    }
  }, [pageData])

  const search = (event: FormEvent) => {
    event.preventDefault()
    setPage(1)
    setQuery(queryDraft.trim())
    setMessage('')
    if (query === queryDraft.trim()) setReload(value => value + 1)
  }

  const updateAccess = async (item: ProfessionalAccess, action: 'trial' | 'paid' | 'extend' | 'revoke') => {
    setBusyId(item.businessId); setError(''); setMessage('')
    try {
      const next = action === 'trial' || action === 'paid' ? await api.grantProfessional(item.businessId, action)
        : action === 'extend' ? await api.extendProfessional(item.businessId)
          : await api.revokeProfessional(item.businessId)
      setPageData(current => current ? { ...current, items: current.items.map(entry => entry.businessId === next.businessId ? next : entry) } : current)
      setConfirmRevokeId(null)
      setHistoryFor(null)
      setMessage(action === 'revoke' ? `Acesso de ${item.ownerName} bloqueado.` :
        `${action === 'trial' ? 'Experiência gratuita liberada' : action === 'extend' ? 'Prazo ampliado' : 'Acesso manual liberado'} para ${item.ownerName} até ${formatDate(next.accessEndsAt)}.`)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível alterar o acesso.') }
    finally { setBusyId(null) }
  }

  const toggleHistory = async (businessId: string) => {
    const requestId = ++historyRequest.current
    if (historyFor === businessId) { setHistoryFor(null); return }
    setHistoryFor(businessId); setHistory([]); setHistoryError(''); setHistoryLoading(true)
    try { const result = await api.professionalAudit(businessId); if (requestId === historyRequest.current) setHistory(result.items) }
    catch (reason) { if (requestId === historyRequest.current) setHistoryError(reason instanceof Error ? reason.message : 'Não foi possível carregar o histórico.') }
    finally { if (requestId === historyRequest.current) setHistoryLoading(false) }
  }

  const signOut = async () => {
    try { await logout(); navigate('/entrar', { replace: true }) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível sair agora.') }
  }

  if (allowed === null) return <main className="center-screen"><Logo /><Loading label="Verificando acesso administrativo..." /></main>
  if (!allowed) return <main className="center-screen superadmin-denied"><LockKeyhole size={27} /><h1>Acesso restrito</h1><p>Este painel é exclusivo do administrador da Nayla.</p><Link className="btn btn-primary" to="/app">Ir para meu espaço <ArrowRight size={16} /></Link></main>

  return <div className="superadmin-page">
    <header className="superadmin-header"><Link to="/superadmin" aria-label="Painel Nayla"><Logo small /></Link><div><span><ShieldCheck size={17} /> Administração Nayla</span><button className="icon-button" type="button" onClick={toggleTheme} aria-label={theme === 'light' ? 'Ativar tema escuro' : 'Ativar tema claro'}>{theme === 'light' ? <Moon size={19} /> : <Sun size={19} />}</button><button className="btn btn-secondary" type="button" onClick={() => void signOut()}><LogOut size={16} /> Sair</button></div></header>
    <main className="superadmin-main">
      <div className="superadmin-intro"><div><span className="eyebrow">GESTÃO DE ACESSOS</span><h1>Profissionais da Nayla</h1><p>Veja suas clientes profissionais e libere o acesso individualmente. A experiência de 30 dias não começa no cadastro; você decide quando ativá-la.</p></div><button className="btn btn-secondary" type="button" disabled={loading} onClick={() => setReload(value => value + 1)}><RefreshCw size={16} /> Atualizar</button></div>
      <section className="superadmin-stats" aria-label="Resumo da página atual"><div><span>Contas encontradas</span><strong>{pageData?.total ?? '—'}</strong></div><div><span>Aguardando nesta página</span><strong>{counts.pending}</strong></div><div><span>Com acesso nesta página</span><strong>{counts.granted}</strong></div><div><span>Precisam de atenção nesta página</span><strong>{counts.attention}</strong></div></section>
      <section className="superadmin-directory" aria-labelledby="superadmin-directory-title"><div className="superadmin-directory-heading"><div><span className="eyebrow">DIRETÓRIO</span><h2 id="superadmin-directory-title">Contas cadastradas</h2></div><form onSubmit={search} role="search"><label htmlFor="superadmin-search" className="sr-only">Buscar profissional, e-mail ou telefone</label><Search size={17} aria-hidden="true" /><input id="superadmin-search" type="search" value={queryDraft} onChange={event => setQueryDraft(event.target.value)} placeholder="Nome, e-mail ou telefone" /><button className="btn btn-primary" type="submit">Buscar</button></form></div>
        <p className="superadmin-manual-note"><ShieldCheck size={16} /> A Nayla não cobra no app. Após receber o pagamento por fora, renove o prazo manualmente aqui.</p>
        {message ? <p className="superadmin-feedback success" role="status"><Check size={16} /> {message}</p> : null}
        {error ? <div className="superadmin-feedback error" role="alert"><span>{error}</span><button className="subtle-link" type="button" onClick={() => error.includes('Entre novamente') ? void signOut() : setReload(value => value + 1)}>{error.includes('Entre novamente') ? 'Entrar novamente' : 'Tentar novamente'}</button></div> : null}
        {loading ? <Loading label="Carregando profissionais..." /> : pageData?.items.length ? <div className="superadmin-list">{pageData.items.map(item => {
          const hasAccess = item.manualAccessStatus === 'trial' || item.manualAccessStatus === 'active'
          const canStartTrial = !item.trialStartedAt && !item.accessEndsAt
          const isBusy = busyId === item.businessId
          return <article className="superadmin-card" key={item.businessId}>
            <div className="superadmin-card-main">
              <div className="superadmin-card-heading"><div><h3>{item.businessName}</h3><span>{item.ownerName}</span></div><span className={`superadmin-status ${item.manualAccessStatus}`}>{statusLabel[item.manualAccessStatus]}</span></div>
              <div className="superadmin-card-info"><a href={`mailto:${item.email}`}><Mail size={15} /> {item.email}</a>{item.phone ? <a href={`tel:${item.phone}`}><Phone size={15} /> {item.phone}</a> : <span><Phone size={15} /> Telefone não informado</span>}<span><CalendarDays size={15} /> Cadastro: {formatDate(item.createdAt)}</span><span>Google: {item.googleConnected ? 'conectado' : 'não conectado'}</span></div>
              <div className="superadmin-card-dates"><span>Experiência: {item.trialStartedAt ? `${formatDate(item.trialStartedAt)} a ${formatDate(item.trialEndsAt)}` : item.accessEndsAt ? 'não aplicada; acesso manual já liberado' : 'ainda não usada'}</span><span>Acesso até: <strong>{formatDate(item.accessEndsAt)}</strong></span></div>
              <div className="superadmin-card-links"><Link className="superadmin-booking-link" to={`/agendar/${item.slug}`} target={Capacitor.isNativePlatform() ? undefined : '_blank'} rel="noreferrer">Ver página de agendamento <ArrowRight size={14} /></Link><button className="superadmin-booking-link" type="button" aria-expanded={historyFor === item.businessId} onClick={() => void toggleHistory(item.businessId)}><History size={14} /> {historyFor === item.businessId ? 'Ocultar histórico' : 'Ver histórico'}</button></div>
            </div>
            <div className="superadmin-card-actions">
              {hasAccess ? <button className="btn btn-primary" type="button" disabled={isBusy} onClick={() => void updateAccess(item, 'extend')}>{isBusy ? 'Salvando...' : 'Adicionar 30 dias de acesso'}</button> : <>
                {canStartTrial ? <button className="btn btn-primary" type="button" disabled={isBusy} onClick={() => void updateAccess(item, 'trial')}>{isBusy ? 'Salvando...' : 'Liberar teste grátis de 30 dias'}</button> : null}
                <button className={canStartTrial ? 'btn btn-secondary' : 'btn btn-primary'} type="button" disabled={isBusy} onClick={() => void updateAccess(item, 'paid')}>{isBusy ? 'Salvando...' : canStartTrial ? 'Liberar 30 dias pagos' : 'Renovar por 30 dias'}</button>
              </>}
              {hasAccess && (confirmRevokeId === item.businessId ? <div className="superadmin-revoke-confirm"><span>Bloquear acesso agora?</span><button className="btn btn-secondary" type="button" disabled={isBusy} onClick={() => void updateAccess(item, 'revoke')}><UserRoundX size={15} /> Confirmar bloqueio</button><button className="subtle-link" type="button" onClick={() => setConfirmRevokeId(null)}>Voltar</button></div> : <button className="subtle-link superadmin-revoke" type="button" disabled={isBusy} onClick={() => setConfirmRevokeId(item.businessId)}>Bloquear acesso</button>)}
            </div>
            {historyFor === item.businessId ? <div className="superadmin-history"><h4>Últimas alterações do acesso</h4>{historyLoading ? <Loading label="Carregando histórico..." /> : historyError ? <p role="alert">{historyError}</p> : history.length ? <ol>{history.map((event, index) => <li key={`${event.createdAt}-${index}`}><strong>{auditLabel[event.action] || 'Acesso alterado'}</strong><span>{formatDateTime(event.createdAt)}</span>{event.reason ? <p>{event.reason}</p> : null}</li>)}</ol> : <p>Nenhuma alteração registrada.</p>}</div> : null}
          </article>
        })}</div> : <div className="superadmin-empty"><Search size={22} /><h3>Nenhuma profissional encontrada</h3><p>Confira o termo de busca ou aguarde as primeiras contas serem criadas.</p></div>}
        {pageData && pageData.total > pageSize ? <nav className="superadmin-pagination" aria-label="Páginas de profissionais"><button className="btn btn-secondary" type="button" disabled={page <= 1 || loading} onClick={() => setPage(value => value - 1)}><ArrowLeft size={15} /> Anterior</button><span>Página {pageData.page} de {Math.ceil(pageData.total / pageData.pageSize)}</span><button className="btn btn-secondary" type="button" disabled={page >= Math.ceil(pageData.total / pageData.pageSize) || loading} onClick={() => setPage(value => value + 1)}>Próxima <ArrowRight size={15} /></button></nav> : null}
      </section>
      <p className="superadmin-footnote">Você está conectada como {session?.user.email}. Este painel mostra informações das profissionais cadastradas; as clientes de cada espaço permanecem no CRM da respectiva profissional.</p>
    </main>
  </div>
}
