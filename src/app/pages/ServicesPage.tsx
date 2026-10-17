import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Clock3, Plus, Scissors, Sparkles, Trash2, X } from 'lucide-react'
import { api, type Service, type Specialty } from '../../lib/api'
import { useAuth } from '../contexts'
import { EmptyState, ErrorState, Loading, money, PageHeading, Panel, serviceCategories, specialties } from '../shared'
import './services.css'
import './admin-motion.css'

const suggestions: Partial<Record<Specialty, Array<{ name: string; durationMinutes: number }>>> = {
  unhas: [
    { name: 'Manicure tradicional', durationMinutes: 60 }, { name: 'Pedicure tradicional', durationMinutes: 60 },
    { name: 'Manicure e pedicure', durationMinutes: 120 }, { name: 'Esmaltação em gel', durationMinutes: 75 },
    { name: 'Blindagem de unhas', durationMinutes: 90 }, { name: 'Banho de gel', durationMinutes: 100 },
    { name: 'Alongamento em fibra de vidro', durationMinutes: 150 }, { name: 'Alongamento em gel', durationMinutes: 150 },
    { name: 'Alongamento em acrigel', durationMinutes: 150 }, { name: 'Manutenção de alongamento', durationMinutes: 120 },
    { name: 'Nail art', durationMinutes: 45 }, { name: 'Spa dos pés', durationMinutes: 60 }, { name: 'Remoção de alongamento', durationMinutes: 60 },
  ],
  sobrancelhas: [
    { name: 'Design de sobrancelhas', durationMinutes: 40 }, { name: 'Design com henna', durationMinutes: 60 },
    { name: 'Design com tintura', durationMinutes: 60 }, { name: 'Brow lamination', durationMinutes: 75 },
    { name: 'Coloração de sobrancelhas', durationMinutes: 45 }, { name: 'Micropigmentação', durationMinutes: 120 },
    { name: 'Retoque de micropigmentação', durationMinutes: 90 }, { name: 'Limpeza de sobrancelhas', durationMinutes: 30 },
  ],
  cilios: [
    { name: 'Extensão fio a fio', durationMinutes: 120 }, { name: 'Volume brasileiro', durationMinutes: 135 },
    { name: 'Volume russo', durationMinutes: 150 }, { name: 'Volume híbrido', durationMinutes: 135 },
    { name: 'Mega volume', durationMinutes: 180 }, { name: 'Lash lifting', durationMinutes: 75 },
    { name: 'Manutenção de extensão', durationMinutes: 90 }, { name: 'Remoção de extensão', durationMinutes: 45 },
    { name: 'Tintura de cílios', durationMinutes: 45 },
  ],
}

type FormValues = { name: string; category: Specialty; description: string; price: string; durationMinutes: string; active: boolean }
const blankForm = (category: Specialty): FormValues => ({ name: '', category, description: '', price: '', durationMinutes: '60', active: true })

export function ServicesPage() {
  const { session } = useAuth()
  const allowed = session?.business.specialties ?? []
  const [items, setItems] = useState<Service[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [retry, setRetry] = useState(0)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Service | null>(null)
  const [form, setForm] = useState<FormValues>(() => blankForm(allowed[0] ?? 'unhas'))
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState<Specialty | 'all'>('all')
  useEffect(() => { let live = true; setLoading(true); setError(''); api.services().then(value => { if (live) setItems(value) }).catch(reason => { if (live) setError(reason instanceof Error ? reason.message : 'Erro ao carregar serviços.') }).finally(() => { if (live) setLoading(false) }); return () => { live = false } }, [retry])
  const scopedItems = useMemo(() => items.filter(item => allowed.includes(item.category as Specialty)), [items, allowed])
  const visible = useMemo(() => scopedItems.filter(item => filter === 'all' || item.category === filter).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')), [scopedItems, filter])
  const openNew = (category?: Specialty, name?: string, durationMinutes?: number) => { if (!allowed.length) return; setEditing(null); setForm({ ...blankForm(allowed[0]), category: category ?? allowed[0], name: name ?? '', durationMinutes: String(durationMinutes ?? 60) }); setActionError(''); setModalOpen(true) }
  const openEdit = (item: Service) => { setEditing(item); setForm({ name: item.name, category: item.category as Specialty, description: item.description ?? '', price: String(item.price), durationMinutes: String(item.durationMinutes), active: item.active }); setActionError(''); setModalOpen(true) }
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!allowed.includes(form.category)) { setActionError('Escolha uma das suas áreas de atuação.'); return } setSaving(true); setActionError(''); const payload = { name: form.name.trim(), category: form.category, description: form.description.trim(), price: Number(form.price), durationMinutes: Number(form.durationMinutes), active: form.active }; try { if (editing) await api.updateService(editing.id, payload); else await api.createService(payload); setModalOpen(false); setRetry(value => value + 1) } catch (reason) { setActionError(reason instanceof Error ? reason.message : 'Não foi possível salvar o serviço.') } finally { setSaving(false) } }
  const toggle = async (item: Service) => { setActionError(''); try { const updated = await api.updateService(item.id, { active: !item.active }); setItems(current => current.map(service => service.id === item.id ? updated : service)) } catch (reason) { setActionError(reason instanceof Error ? reason.message : 'Não foi possível alterar o serviço.') } }
  const remove = async (item: Service) => { if (!window.confirm(`Arquivar “${item.name}”?`)) return; setActionError(''); try { await api.deleteService(item.id); setItems(current => current.map(service => service.id === item.id ? { ...service, active: false } : service)) } catch (reason) { setActionError(reason instanceof Error ? reason.message : 'Não foi possível arquivar o serviço.') } }
  const availableSuggestions = allowed.flatMap(category => (suggestions[category] ?? []).filter(suggestion => !items.some(item => item.name.toLocaleLowerCase('pt-BR') === suggestion.name.toLocaleLowerCase('pt-BR'))).map(suggestion => ({ ...suggestion, category })))
  return <div className="page"><PageHeading eyebrow="SEU CATÁLOGO" title="Seus serviços" description="Personalize preços e duração. Suas clientes verão apenas os serviços ativos das suas áreas de atuação." action={<button className="btn btn-primary" onClick={() => openNew()}><Plus size={18}/> Novo serviço</button>} /><div className="service-setup-note"><strong>Escolha o que sua cliente pode agendar</strong><span>Ative somente os serviços que você oferece. Os itens desativados ficam no seu catálogo, mas não aparecem no seu link de agendamento. Personalize preço e duração em Editar.</span></div><Panel><div className="panel-heading wrap"><div><span className="eyebrow">SERVIÇOS CADASTRADOS</span><h2>{scopedItems.length} {scopedItems.length === 1 ? 'serviço' : 'serviços'}</h2></div><div className="tab-filter"><button className={filter === 'all' ? 'selected' : ''} onClick={() => setFilter('all')}>Todos</button>{allowed.map(item => <button key={item} className={filter === item ? 'selected' : ''} onClick={() => setFilter(item)}>{specialties[item]}</button>)}</div></div>{actionError && !modalOpen ? <p className="form-error" role="alert">{actionError}</p> : null}{loading ? <Loading label="Carregando serviços..." /> : error ? <ErrorState message={error} onRetry={() => setRetry(value => value + 1)} /> : visible.length ? <div className="service-grid">{visible.map(item => <article className={`service-card ${item.active ? '' : 'service-inactive'}`} key={item.id}><div className="service-card-top"><span className="service-category">{serviceCategories[item.category]}</span><label className="switch" title={item.active ? 'Desativar serviço' : 'Ativar serviço'}><input type="checkbox" checked={item.active} onChange={() => void toggle(item)} aria-label={`${item.active ? 'Desativar' : 'Ativar'} ${item.name}`} /><span/></label></div><h3>{item.name}</h3><p>{item.description || 'Personalize a descrição para suas clientes.'}</p><div className="service-meta"><span><Clock3 size={15}/> {item.durationMinutes} min</span><strong>{money(item.price)}</strong></div><div className="service-actions"><button onClick={() => openEdit(item)}>Editar</button><button onClick={() => void remove(item)} aria-label={`Arquivar ${item.name}`}><Trash2 size={16}/></button></div></article>)}</div> : <EmptyState title="Nenhum serviço nesta categoria" detail="Adicione seus serviços para receber agendamentos." action={<button className="btn btn-secondary" onClick={() => openNew(filter === 'all' ? undefined : filter)}>Adicionar serviço</button>} />}</Panel>{availableSuggestions.length ? <Panel className="suggestions-panel"><div className="panel-heading"><div><span className="eyebrow">IDEIAS PARA SEU CATÁLOGO</span><h2>Adicione com um clique</h2></div><Sparkles size={22}/></div><p>Escolha um serviço que você oferece e defina o seu preço.</p><div className="suggestion-tags">{availableSuggestions.slice(0, 12).map(item => <button key={`${item.category}-${item.name}`} onClick={() => openNew(item.category, item.name, item.durationMinutes)}><Plus size={14}/>{item.name}</button>)}</div></Panel> : null}{modalOpen ? <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setModalOpen(false) }}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="service-title"><div className="modal-head"><span className="modal-icon"><Scissors size={22}/></span><button className="icon-button" onClick={() => setModalOpen(false)} aria-label="Fechar"><X size={21}/></button></div><h2 id="service-title">{editing ? 'Editar serviço' : 'Novo serviço'}</h2><p>Essas informações vão aparecer na sua página de agendamento.</p><form className="form-stack" onSubmit={submit}><label>Nome do serviço<input value={form.name} onChange={e => setForm(current => ({ ...current, name: e.target.value }))} placeholder="Ex.: Design de sobrancelhas" maxLength={100} required /></label><label>Área<select value={form.category} onChange={e => setForm(current => ({ ...current, category: e.target.value as Specialty }))}>{allowed.map(item => <option key={item} value={item}>{specialties[item]}</option>)}</select></label><div className="form-row"><label>Preço (R$)<input type="number" min="0" step="0.01" value={form.price} onChange={e => setForm(current => ({ ...current, price: e.target.value }))} placeholder="0,00" required /></label><label>Duração (min)<input type="number" min="15" step="5" value={form.durationMinutes} onChange={e => setForm(current => ({ ...current, durationMinutes: e.target.value }))} required /></label></div><label>Descrição<textarea rows={3} value={form.description} onChange={e => setForm(current => ({ ...current, description: e.target.value }))} placeholder="Conte um pouco sobre esse serviço" /></label>{actionError ? <p className="form-error" role="alert">{actionError}</p> : null}<div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={() => setModalOpen(false)}>Cancelar</button><button className="btn btn-primary" disabled={saving}>{saving ? 'Salvando...' : 'Salvar serviço'}</button></div></form></div></div> : null}</div>
}
