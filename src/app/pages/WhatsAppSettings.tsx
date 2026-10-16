import { useEffect, useState, type FormEvent } from 'react'
import { Check, Copy, ExternalLink, MessageCircle, RefreshCw, ShieldCheck } from 'lucide-react'
import { Browser } from '@capacitor/browser'
import { api, type Notification, type NotificationStatus, type WhatsAppConfig, type WhatsAppConfigUpdate } from '../../lib/api'
import { isNativeApp } from '../../lib/nativeSession'
import { EmptyState, ErrorState, Loading, Panel } from '../shared'
import './WhatsAppSettings.css'

const statusCopy: Record<NotificationStatus, string> = {
  pending: 'Em processamento',
  opted_out: 'Sem consentimento',
  simulated: 'Simulado · não enviado',
  not_configured: 'Sem configuração',
  accepted: 'Aceito pelo WhatsApp',
  sent: 'Enviado · aguardando entrega',
  delivered: 'Entregue',
  read: 'Lido',
  failed: 'Falhou',
}

const modeCopy: Record<WhatsAppConfig['mode'], string> = {
  disabled: 'Desativado',
  simulate: 'Simulação',
  meta: 'Meta WhatsApp Cloud API',
}

const historyDate = (value: string) => new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
}).format(new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(' ', 'T')}Z` : value))

function manualWhatsAppUrl(item: Notification) {
  const digits = item.recipient.replace(/\D/g, '')
  const phone = digits.startsWith('55') ? digits : `55${digits}`
  if (!/^55\d{10,11}$/.test(phone) || !item.message.trim()) return null
  return `https://wa.me/${phone}?text=${encodeURIComponent(item.message)}`
}

export function WhatsAppSettings() {
  const [config, setConfig] = useState<WhatsAppConfig | null>(null)
  const [form, setForm] = useState<WhatsAppConfigUpdate>({ mode: 'disabled', templateName: '', urgentTemplateName: '', sender: '', phoneNumberId: '', accessToken: '', appSecret: '' })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saved, setSaved] = useState(false)
  const [retry, setRetry] = useState(0)
  const [copied, setCopied] = useState<'url' | 'token' | null>(null)
  useEffect(() => {
    let live = true
    setLoading(true)
    setError('')
    api.whatsappConfig().then(value => {
      if (!live) return
      setConfig(value)
      setForm({ mode: value.mode, templateName: value.templateName ?? '', urgentTemplateName: value.urgentTemplateName ?? '', sender: value.sender ?? '', phoneNumberId: value.phoneNumberId ?? '', accessToken: '', appSecret: '' })
    }).catch(reason => { if (live) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar a configuração.') })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [retry])
  const save = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true); setSaveError(''); setSaved(false)
    try {
      const payload = {
        mode: form.mode,
        templateName: form.templateName.trim(),
        urgentTemplateName: form.urgentTemplateName?.trim() || '',
        sender: form.sender.trim(),
        phoneNumberId: form.phoneNumberId.trim(),
        ...(form.accessToken?.trim() ? { accessToken: form.accessToken.trim() } : {}),
        ...(form.appSecret?.trim() ? { appSecret: form.appSecret.trim() } : {}),
      }
      const updated = await api.updateWhatsappConfig(payload)
      setConfig(updated)
      setForm(current => ({ ...current, accessToken: '', appSecret: '' }))
      setSaved(true)
    } catch (reason) { setSaveError(reason instanceof Error ? reason.message : 'Não foi possível salvar a integração.') }
    finally { setSaving(false) }
  }
  const copy = async (value: string, kind: 'url' | 'token') => {
    try { await navigator.clipboard.writeText(value); setCopied(kind); window.setTimeout(() => setCopied(null), 2500) }
    catch { setSaveError('Não foi possível copiar. Selecione o texto manualmente.') }
  }
  return <Panel className="whatsapp-panel"><div className="panel-heading"><div><span className="eyebrow">COMUNICAÇÃO</span><h2>Confirmação por WhatsApp</h2></div><span className="whatsapp-heading-icon"><MessageCircle size={22}/></span></div>
    {loading ? <Loading label="Carregando a integração..." /> : error ? <ErrorState message={error} onRetry={() => setRetry(value => value + 1)} /> : config ? <div className="whatsapp-content">
      <p className="whatsapp-intro">Escolha como este espaço trata confirmações, alterações e cancelamentos. Mensagens automáticas só são enviadas às clientes que autorizarem no agendamento.</p>
      <div className={`integration-state ${config.mode}`}><span className="integration-state-dot"/><strong>{modeCopy[config.mode]}</strong><span>{config.mode === 'simulate' ? 'Nenhuma mensagem sai do sistema neste modo.' : config.mode === 'meta' && config.configured ? (config.urgentConfigured ? 'Credenciais e nomes dos modelos preenchidos. Confirme aprovação e texto dos modelos na Meta.' : 'Credenciais de confirmação preenchidas; configure e aprove também o modelo urgente na Meta.') : config.mode === 'meta' ? 'Preencha as credenciais para habilitar o envio.' : 'Nenhuma mensagem automática será enviada.'}</span></div>
      <form className="form-stack" onSubmit={save}><fieldset className="mode-options"><legend>Modo de envio</legend><div>{(['disabled', 'simulate', 'meta'] as const).map(mode => <label key={mode} className={form.mode === mode ? 'selected' : ''}><input type="radio" name="whatsapp-mode" value={mode} checked={form.mode === mode} onChange={() => setForm(current => ({ ...current, mode }))}/><span><strong>{modeCopy[mode]}</strong><small>{mode === 'disabled' ? 'Desliga a automação.' : mode === 'simulate' ? 'Registra a tentativa para testar o fluxo, sem enviar.' : 'Usa as credenciais da sua conta Meta para envio real.'}</small></span></label>)}</div></fieldset>
        {form.mode === 'meta' ? <div className="whatsapp-credentials"><div className="whatsapp-callout"><ShieldCheck size={19}/><span>Use modelos aprovados em pt_BR. A confirmação usa seis variáveis: cliente, espaço, serviço, dia da semana, data e horário. O aviso urgente usa quatro: cliente, espaço, resumo da alteração e horários disponíveis. Seus segredos não são exibidos depois de salvar.</span></div><div className="form-row"><label>Número da conta (referência, com DDI)<input value={form.sender} onChange={event => setForm(current => ({ ...current, sender: event.target.value }))} placeholder="5511999999999" inputMode="tel" required/></label><label>Phone Number ID<input value={form.phoneNumberId} onChange={event => setForm(current => ({ ...current, phoneNumberId: event.target.value }))} placeholder="ID da Meta" required/></label></div><p className="whatsapp-meta-help">O envio real usa o Phone Number ID configurado na Meta. O número de referência acima não é verificado pela Nayla.</p><label>Modelo de confirmação aprovado<input value={form.templateName} onChange={event => setForm(current => ({ ...current, templateName: event.target.value }))} placeholder="confirmacao_agendamento" required/></label><label>Modelo de aviso urgente aprovado<input value={form.urgentTemplateName ?? ''} onChange={event => setForm(current => ({ ...current, urgentTemplateName: event.target.value }))} placeholder="aviso_urgente_agendamento"/></label><p className="whatsapp-meta-help">O modelo urgente deve começar com RESPONDER URGENTE e conter quatro variáveis, na ordem informada acima. Sem ele, alterações e cancelamentos são registrados sem envio automático.</p><div className="form-row"><label>Access token<input type="password" value={form.accessToken ?? ''} onChange={event => setForm(current => ({ ...current, accessToken: event.target.value }))} placeholder={config.hasAccessToken ? 'Salvo · deixe vazio para manter' : 'Cole o token de acesso'} autoComplete="off" required={!config.hasAccessToken}/></label><label>App secret<input type="password" value={form.appSecret ?? ''} onChange={event => setForm(current => ({ ...current, appSecret: event.target.value }))} placeholder={config.hasAppSecret ? 'Salvo · deixe vazio para manter' : 'Cole o segredo do aplicativo'} autoComplete="off" required={!config.hasAppSecret}/></label></div><div className="webhook-box"><strong>Webhook para status de entrega</strong><p>Cadastre esta URL e o token de verificação no painel do aplicativo da Meta. O status só muda para entregue ou lido após o retorno do webhook.</p><label>URL de callback<div className="copy-field"><input value={config.webhookUrl} readOnly onFocus={event => event.target.select()}/><button type="button" onClick={() => void copy(config.webhookUrl, 'url')}>{copied === 'url' ? <Check size={16}/> : <Copy size={16}/>} Copiar</button></div></label><label>Token de verificação<div className="copy-field"><input value={config.webhookVerifyToken} readOnly onFocus={event => event.target.select()}/><button type="button" onClick={() => void copy(config.webhookVerifyToken, 'token')}>{copied === 'token' ? <Check size={16}/> : <Copy size={16}/>} Copiar</button></div></label><small>{config.webhookConfigured ? 'Dados locais do webhook prontos. Confirme o cadastro no painel da Meta.' : 'Configure o webhook para acompanhar entrega e leitura.'}</small></div></div> : null}
        {saveError ? <p className="form-error" role="alert">{saveError}</p> : null}{saved ? <p className="form-success" role="status"><Check size={16}/> Configuração de WhatsApp salva.</p> : null}<div className="settings-actions"><button className="btn btn-primary" disabled={saving}>{saving ? 'Salvando...' : 'Salvar WhatsApp'}</button></div></form></div> : null}</Panel>
}

export function NotificationHistory() {
  const [items, setItems] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let live = true
    setLoading(true); setError('')
    api.notifications().then(value => { if (live) setItems(value) })
      .catch(reason => { if (live) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar o histórico.') })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [retry])
  useEffect(() => {
    let live = true
    const refresh = () => {
      if (document.visibilityState === 'hidden') return
      void api.notifications().then(value => { if (live) setItems(value) }).catch(() => {})
    }
    const timer = window.setInterval(refresh, 15_000)
    window.addEventListener('focus', refresh)
    return () => { live = false; window.clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [])
  return <Panel className="notification-history"><div className="panel-heading"><div><span className="eyebrow">HISTÓRICO</span><h2>Mensagens dos agendamentos</h2></div><button className="icon-button" onClick={() => setRetry(value => value + 1)} title="Atualizar histórico" aria-label="Atualizar histórico"><RefreshCw size={19}/></button></div><p className="notification-intro">O texto abaixo é uma prévia local. No envio real, a Meta usa o corpo do modelo aprovado na conta da profissional. Estados simulados e sem consentimento não representam envio.</p>{loading ? <Loading label="Carregando histórico..."/> : error ? <ErrorState message={error} onRetry={() => setRetry(value => value + 1)}/> : items.length ? <div className="notification-list">{items.map(item => { const url = item.canContact === true && !['opted_out', 'pending', 'accepted', 'sent', 'delivered', 'read'].includes(item.status) ? manualWhatsAppUrl(item) : null; const urgent = item.message.startsWith('RESPONDER URGENTE'); return <article key={item.id} className={`notification-row ${urgent ? 'urgent' : ''}`}><div className="notification-row-top"><strong>{item.recipient}</strong>{urgent ? <span className="urgent-message-badge">Responder urgente</span> : null}<span className={`notification-status ${item.status}`}>{statusCopy[item.status]}</span></div><small>{historyDate(item.createdAt)}</small><p>{item.message}</p>{item.error ? <p className="notification-error">{item.error}</p> : null}{url ? <a className="subtle-link" href={url} target="_blank" rel="noreferrer" onClick={event => { if (isNativeApp) { event.preventDefault(); void Browser.open({ url }) } }}>Abrir no WhatsApp <ExternalLink size={15}/></a> : null}</article> })}</div> : <EmptyState title="Nenhuma mensagem registrada" detail="Os registros aparecerão aqui após os primeiros agendamentos."/>}<p className="manual-send-note">“Abrir no WhatsApp” prepara a mensagem. O envio só acontece depois que você tocar em Enviar. A Cloud API não aplica etiquetas nativas às conversas; o aviso urgente fica destacado na prévia e neste histórico. Acompanhe as respostas da cliente na conta WhatsApp conectada.</p></Panel>
}
