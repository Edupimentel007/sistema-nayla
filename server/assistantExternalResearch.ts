/**
 * Public, tenant-independent research for business advice. Only fixed HTTPS
 * hosts and generic, locally classified terms ever leave this server.
 * Conversation text, business names, client data and financial data do not.
 */

export type ExternalSource = {
  title: string;
  url: string;
  excerpt?: string;
  date?: string;
  actionHint?: string;
};

export type ExternalResearch = {
  summary: string;
  sources: ExternalSource[];
  status: 'ok' | 'unavailable' | 'no_results';
};

type Intent = 'diferenciacao' | 'divulgacao' | 'fidelizacao' | 'precos' | 'seguranca' | 'tendencias';
type Area = 'unhas' | 'sobrancelhas' | 'cilios' | 'cabelos' | 'terapia_capilar' |
  'maquiagem' | 'depilacao' | 'estetica_facial' | 'estetica_corporal' |
  'massagens' | 'micropigmentacao' | 'bronzeamento' | 'podologia' | 'outros';
type CatalogEntry = ExternalSource & { intents: readonly Intent[]; areas?: readonly Area[] };
type ResearchOptions = { fetchImpl?: typeof fetch; timeoutMs?: number; cache?: boolean };

const BLOG = 'blog.rn.sebrae.com.br';
const ALLOWED_HOSTS = new Set([
  BLOG,
  'inteligenciademercado.rj.sebrae.com.br',
  'meuatendimento.sebrae.com.br',
  'support.google.com',
  'www.gov.br',
]);

// These are editorially selected pages, not arbitrary URLs from a chat message.
// A source is returned only after a successful live response from its page.
const CATALOG: readonly CatalogEntry[] = [
  {
    title: 'Visual merchandising em empreendimentos de beleza — Sebrae',
    url: 'https://inteligenciademercado.rj.sebrae.com.br/beleza/Visual-merchandising-em-empreendimentos-de-beleza',
    intents: ['diferenciacao', 'fidelizacao'],
    actionHint: 'Organize o espaço e a apresentação dos serviços para que a cliente perceba o valor do atendimento.',
  },
  {
    title: 'Valor agregado: como aumentar — Sebrae RN',
    url: 'https://blog.rn.sebrae.com.br/valor-agregado/',
    intents: ['precos', 'fidelizacao'],
    actionHint: 'Mostre benefícios concretos e personalize a experiência antes de competir só por preço.',
  },
  {
    title: 'Perfil da Empresa no Google — Sebrae RN',
    url: 'https://blog.rn.sebrae.com.br/google-perfil-da-empresa/',
    intents: ['diferenciacao', 'divulgacao'],
    actionHint: 'Atualize serviços, preços, fotos, horários e contato no Perfil da Empresa para facilitar a descoberta local.',
  },
  {
    title: 'Marketing de baixo custo para MEI — Sebrae RN',
    url: 'https://blog.rn.sebrae.com.br/marketing-de-baixo-custo-para-mei/',
    intents: ['divulgacao', 'diferenciacao'],
    actionHint: 'Teste parcerias com negócios próximos e peça permissão para compartilhar resultados reais das clientes.',
  },
  {
    title: 'Como vender pelo Instagram em 2026 — Sebrae RN',
    url: 'https://blog.rn.sebrae.com.br/como-vender-pelo-instagram-2026/',
    intents: ['divulgacao', 'tendencias'],
    actionHint: 'Publique conteúdo educativo, bastidores e depoimentos autorizados, com um caminho claro para agendar.',
  },
  {
    title: 'Satisfação do cliente: como avaliar — Sebrae RN',
    url: 'https://blog.rn.sebrae.com.br/satisfacao-do-cliente/',
    intents: ['fidelizacao', 'diferenciacao'],
    actionHint: 'Peça feedback após o atendimento e acompanhe avaliações para corrigir problemas recorrentes.',
  },
  {
    title: 'Inovação contínua para pequenos negócios — Sebrae RN',
    url: 'https://blog.rn.sebrae.com.br/inovacao-continua/',
    intents: ['diferenciacao', 'fidelizacao', 'tendencias'],
    actionHint: 'Teste ajustes nos horários e lembretes para reduzir a espera e as faltas.',
  },
  {
    title: 'Por que meu salão não dá lucro? — Sebrae',
    url: 'https://meuatendimento.sebrae.com.br/sites/PortalSebrae/ufs/pe/artigos/por-que-meu-salao-de-beleza-nao-da-lucro-6-erros-a-serem-evitados%2C427db968e2de5910VgnVCM1000001b00320aRCRD',
    intents: ['precos'],
    actionHint: 'Revise custos, reservas para meses fracos e resultado das promoções antes de baixar preços.',
  },
  {
    title: 'Tendências de Beleza 2025–2027 — Sebrae',
    url: 'https://inteligenciademercado.rj.sebrae.com.br/multissetorial/Tendencias-de-Beleza-2025-2027',
    intents: ['tendencias', 'diferenciacao'],
    actionHint: 'Observe mudanças na procura e teste uma novidade de cada vez antes de ampliar o cardápio.',
  },
  {
    title: 'Como gerenciar fotos no Perfil da Empresa — Google',
    url: 'https://support.google.com/business/answer/6103862?hl=pt-BR',
    intents: ['divulgacao'],
    actionHint: 'Adicione fotos nítidas dos resultados e do espaço ao Perfil da Empresa, sempre com autorização da cliente.',
  },
  {
    title: 'Como criar postagens no Perfil da Empresa — Google',
    url: 'https://support.google.com/business/answer/7342169?hl=pt-BR',
    intents: ['divulgacao'],
    actionHint: 'Publique novidades e ofertas no Perfil da Empresa e mantenha as informações atualizadas.',
  },
  {
    title: 'Estabelecimento seguro em estética — Anvisa',
    url: 'https://www.gov.br/anvisa/pt-br/comunicacao/campanhas/estetica/estabelecimento-seguro',
    intents: ['seguranca'],
    actionHint: 'Revise a rotina de higiene e segurança do espaço e explique esses cuidados às clientes.',
  },
  {
    title: 'O que é preciso para montar um salão de beleza — Sebrae',
    url: 'https://meuatendimento.sebrae.com.br/sites/PortalSebrae/artigos/o-que-e-preciso-para-montar-um-salao-de-beleza%2C0d4e1ab384336810VgnVCM1000001b00320aRCRD',
    intents: ['seguranca', 'diferenciacao'],
    actionHint: 'Cuide da biossegurança e da presença digital antes de aumentar a estrutura.',
  },
  {
    title: 'Estética facial: como se destacar — Sebrae',
    url: 'https://meuatendimento.sebrae.com.br/sites/PortalSebrae/ufs/pe/arquivos/estetica-facial-como-se-destacar-nesse-mercado-em-ascensao%2C0f38082392e5a810VgnVCM1000001b00320aRCRD',
    intents: ['diferenciacao', 'tendencias'],
    areas: ['estetica_facial'],
    actionHint: 'Observe quais procedimentos têm procura local e capacite-se antes de ampliar a oferta.',
  },
];

const normalized = (value: string) => value.normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase();

function intentFrom(topic: string): Intent {
  const value = normalized(topic);
  if (/higien|esteriliz|biossegur|anvisa|seguran|infecc/.test(value)) return 'seguranca';
  if (/preco|precific|cobr|valor|ticket|margem|lucro|rentab|custo/.test(value)) return 'precos';
  if (/fideliz|retenc|retorn|voltar|recorr|indicac/.test(value)) return 'fidelizacao';
  if (/instagram|reels|divulg|marketing|anunci|public|rede social|atrair|perfil google/.test(value))
    return 'divulgacao';
  if (/tendenc|novidad|moda|atualiz|inovacao|202[5-9]/.test(value)) return 'tendencias';
  return 'diferenciacao';
}

function areaFrom(raw: string): Area | null {
  const value = normalized(raw);
  const exact = new Set<Area>([
    'unhas', 'sobrancelhas', 'cilios', 'cabelos', 'terapia_capilar',
    'maquiagem', 'depilacao', 'estetica_facial', 'estetica_corporal',
    'massagens', 'micropigmentacao', 'bronzeamento', 'podologia', 'outros',
  ]);
  if (exact.has(value as Area)) return value as Area;
  if (/unha|manicur|pedicur|esmal|nail/.test(value)) return 'unhas';
  if (/micropigment/.test(value)) return 'micropigmentacao';
  if (/sobrancelh|brow/.test(value)) return 'sobrancelhas';
  if (/cilio|lash/.test(value)) return 'cilios';
  if (/terapia.?capilar|tricolog/.test(value)) return 'terapia_capilar';
  if (/cabelo|capilar|cabeleir|tricolog/.test(value)) return 'cabelos';
  if (/maqui|make.?up/.test(value)) return 'maquiagem';
  if (/depil/.test(value)) return 'depilacao';
  if (/estetica.?facial|facial/.test(value)) return 'estetica_facial';
  if (/estetica.?corporal|corporal/.test(value)) return 'estetica_corporal';
  if (/massag/.test(value)) return 'massagens';
  if (/bronze/.test(value)) return 'bronzeamento';
  if (/podolog/.test(value)) return 'podologia';
  return null;
}

function safeUrl(value: string, host?: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname) ||
        (host && url.hostname !== host) || url.port || url.username || url.password || url.hash)
      return null;
    return url.toString();
  } catch { return null; }
}

function decodeEntities(value: string) {
  const names: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    ndash: '–', mdash: '—', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…',
    aacute: 'á', agrave: 'à', atilde: 'ã', acirc: 'â', auml: 'ä',
    eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë',
    iacute: 'í', igrave: 'ì', icirc: 'î', iuml: 'ï',
    oacute: 'ó', ograve: 'ò', otilde: 'õ', ocirc: 'ô', ouml: 'ö',
    uacute: 'ú', ugrave: 'ù', ucirc: 'û', uuml: 'ü',
    ccedil: 'ç', ntilde: 'ñ',
  };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const point = name[1].toLowerCase() === 'x'
        ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isInteger(point) && point > 0 && point <= 0x10ffff
        ? String.fromCodePoint(point) : whole;
    }
    const decoded = names[name.toLowerCase()];
    return decoded && name[0] === name[0].toUpperCase() ? decoded.toUpperCase() : decoded ?? whole;
  });
}

function plainText(html: string) {
  return decodeEntities(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}

function shortExcerpt(value: string) {
  const allWords = plainText(value).split(/\s+/).filter(Boolean);
  const clipped = allWords.slice(0, 24).join(' ');
  let result = clipped.length > 180 ? clipped.slice(0, 177).replace(/\s+\S*$/, '') : clipped;
  const sentence = [...result.matchAll(/[.!?](?=\s|$)/g)].at(-1);
  if (sentence && sentence.index >= 80) result = result.slice(0, sentence.index + 1);
  else if (allWords.length > 24 || clipped.length > 180) result = `${result.replace(/[.,;:]+$/, '')}…`;
  return result.slice(0, 180);
}

function metaContent(html: string, key: string) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const property = tag.match(/(?:name|property)\s*=\s*["']([^"']+)["']/i)?.[1];
    if (property?.toLowerCase() !== key) continue;
    return decodeEntities(tag.match(/content\s*=\s*["']([^"']+)["']/i)?.[1] ?? '');
  }
  return '';
}

async function limitedText(response: Response, maxBytes: number) {
  const declared = Number(response.headers.get('content-length'));
  if (declared > maxBytes) throw new Error('source too large');
  if (!response.body) throw new Error('empty source');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) throw new Error('source too large');
      chunks.push(next.value);
    }
  } finally { void reader.cancel().catch(() => undefined); }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function pageExcerpt(html: string, intent: Intent): string {
  const description = metaContent(html, 'description') || metaContent(html, 'og:description');
  const intentWords: Record<Intent, RegExp> = {
    diferenciacao: /diferenc|destac|experien|cliente|valor|atendimento/i,
    divulgacao: /marketing|instagram|perfil|foto|post|redes|divulg/i,
    fidelizacao: /fidel|retorn|cliente|satisf|agend/i,
    precos: /preco|cust|lucro|margem|valor|financeir/i,
    seguranca: /segur|higien|esteriliz|biossegur|limpez/i,
    tendencias: /tendenc|inovac|novidad|mercado|beleza/i,
  };
  const paragraphs = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .slice(0, 120).map(match => plainText(match[1]))
    .filter(item => item.length >= 70 && item.length <= 1400 &&
      !/cookies|cadastre-se|newsletter|javascript|todos os direitos reservados/i.test(item));
  const relevant = paragraphs.map((item, index) => ({
    item,
    score: (intentWords[intent].test(normalized(item)) ? 3 : 0) +
      (/ofere[cç]a|invista|crie|publique|analise|organize|personaliz|fa[cç]a|recomenda|apost[ea]|permite|reduz|melhor/i.test(item) ? 2 : 0) -
      Math.min(index / 100, 1),
  })).sort((a, b) => b.score - a.score)[0];
  const answer = relevant?.score > 2 ? relevant.item :
    (description.length > 50 ? description : paragraphs[0] ?? '');
  return shortExcerpt(answer);
}

function pageDate(html: string) {
  const date = metaContent(html, 'article:modified_time') ||
    metaContent(html, 'article:published_time') ||
    html.match(/Atualizado\s+em\s+(\d{2}\/\d{2}\/\d{4})/i)?.[1] || '';
  return date.slice(0, 25) || undefined;
}

async function catalogSource(entry: CatalogEntry, intent: Intent, fetchImpl: typeof fetch,
  signal: AbortSignal, onReachable: () => void): Promise<ExternalSource | null> {
  const url = safeUrl(entry.url);
  if (!url) return null;
  try {
    const response = await fetchImpl(url, {
      signal, redirect: 'error', headers: { Accept: 'text/html', 'User-Agent': 'NaylaResearch/1.0' },
    });
    if (!response.ok || !(response.headers.get('content-type') ?? '').toLowerCase().includes('text/html'))
      return null;
    onReachable();
    const html = await limitedText(response, 450_000);
    const excerpt = pageExcerpt(html, intent);
    if (excerpt.length < 45 || /faça login|acesso restrito|conteúdo exclusivo/i.test(excerpt)) return null;
    return { title: entry.title, url, excerpt, date: pageDate(html), actionHint: entry.actionHint };
  } catch { return null; }
}

const WORDPRESS_TERMS: Record<Intent, string> = {
  diferenciacao: 'valor agregado', divulgacao: 'marketing de baixo custo',
  fidelizacao: 'satisfação do cliente', precos: 'precificação',
  seguranca: 'segurança salão', tendencias: 'beleza',
};

async function dynamicSebraeSource(intent: Intent, fetchImpl: typeof fetch,
  signal: AbortSignal, onReachable: () => void): Promise<ExternalSource | null> {
  const url = new URL(`https://${BLOG}/wp-json/wp/v2/posts`);
  url.searchParams.set('search', WORDPRESS_TERMS[intent]);
  url.searchParams.set('per_page', '20');
  url.searchParams.set('_fields', 'title,excerpt,link,date');
  try {
    const response = await fetchImpl(url.toString(), {
      signal, redirect: 'error', headers: { Accept: 'application/json', 'User-Agent': 'NaylaResearch/1.0' },
    });
    if (!response.ok || !(response.headers.get('content-type') ?? '').toLowerCase().includes('application/json'))
      return null;
    onReachable();
    const posts = JSON.parse(await limitedText(response, 100_000)) as unknown;
    if (!Array.isArray(posts)) return null;
    type RankedPost = { title: string; url: string; excerpt: string; date: string | undefined; score: number };
    const ranked = posts.map((post: unknown): RankedPost | null => {
      if (!post || typeof post !== 'object') return null;
      const item = post as Record<string, unknown>;
      const title = plainText((item.title as { rendered?: string } | undefined)?.rendered ?? '');
      const excerpt = plainText((item.excerpt as { rendered?: string } | undefined)?.rendered ?? '');
      const link = typeof item.link === 'string' ? safeUrl(item.link, BLOG) : null;
      const date = typeof item.date === 'string' ? item.date.slice(0, 10) : undefined;
      if (!link || title.length < 12 || excerpt.length < 45) return null;
      const keywords: Record<Intent, { strong: RegExp; weak: RegExp }> = {
        diferenciacao: { strong: /valor agregado|proposta de valor|diferenc|posicionamento/i,
          weak: /inovac|experien|atendimento/i },
        divulgacao: { strong: /marketing|divulg|instagram|reels|rede social/i,
          weak: /cliente|venda/i },
        fidelizacao: { strong: /satisf|fidel|retenc|relacionamento/i,
          weak: /cliente|atendimento/i },
        precos: { strong: /preco|precific|custo|lucro|margem/i,
          weak: /valor|financeir/i },
        seguranca: { strong: /segur|higien|biossegur|anvisa/i,
          weak: /sal[aã]o|beleza/i },
        tendencias: { strong: /tendenc.{0,25}beleza|beleza.{0,25}tendenc|estetic/i,
          weak: /beleza|cosmet|manicur|cabel/i },
      };
      const { strong, weak } = keywords[intent];
      const titleText = normalized(title);
      const excerptText = normalized(excerpt);
      const score = (strong.test(titleText) ? 6 : 0) + (weak.test(titleText) ? 2 : 0) +
        (strong.test(excerptText) ? 1 : 0);
      return { title: `${title} — Sebrae RN`, url: link, excerpt: shortExcerpt(excerpt), date, score };
    }).filter((entry): entry is RankedPost => entry !== null);
    ranked.sort((a, b) => b.score - a.score);
    const best = ranked[0];
    if (!best || best.score < 6) return null;
    // The search response identifies a candidate; verify and read its actual
    // article before presenting it as a consulted source.
    const article = await fetchImpl(best.url, {
      signal, redirect: 'error', headers: { Accept: 'text/html', 'User-Agent': 'NaylaResearch/1.0' },
    });
    if (!article.ok || !(article.headers.get('content-type') ?? '').toLowerCase().includes('text/html'))
      return null;
    const html = await limitedText(article, 450_000);
    const excerpt = pageExcerpt(html, intent);
    if (excerpt.length < 45) return null;
    return { title: best.title, url: best.url, excerpt, date: best.date };
  } catch { return null; }
}

const cached = new Map<string, { until: number; result: ExternalResearch }>();
const pending = new Map<string, Promise<ExternalResearch>>();

export async function researchExternalAdvice(topic: string, areas: readonly string[],
  options: ResearchOptions = {}): Promise<ExternalResearch> {
  const intent = intentFrom(topic);
  const knownAreas = [...new Set(areas.map(areaFrom).filter((area): area is Area => area !== null))].sort();
  const key = `${intent}:${knownAreas.join(',')}`;
  const useCache = options.cache !== false && !options.fetchImpl;
  const stored = useCache ? cached.get(key) : undefined;
  if (stored && stored.until > Date.now()) return stored.result;
  if (useCache && pending.has(key)) return pending.get(key)!;

  const run = async (): Promise<ExternalResearch> => {
    const controller = new AbortController();
    const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 4_500, 100), 4_800);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let reachable = false;
    const onReachable = () => { reachable = true; };
    try {
      const ranked = CATALOG.filter(entry => entry.intents.includes(intent))
        .sort((a, b) => Number(Boolean(b.areas?.some(area => knownAreas.includes(area)))) -
          Number(Boolean(a.areas?.some(area => knownAreas.includes(area)))));
      const selected = ranked.filter(entry => !entry.areas || entry.areas.some(area => knownAreas.includes(area)))
        .slice(0, 2);
      const fetchImpl = options.fetchImpl ?? fetch;
      const results = await Promise.all([
        ...selected.map(entry => catalogSource(entry, intent, fetchImpl, controller.signal, onReachable)),
        dynamicSebraeSource(intent, fetchImpl, controller.signal, onReachable),
      ]);
      const sources = [...new Map(results.filter((source): source is ExternalSource => source !== null)
        .map(source => [source.url, source])).values()].slice(0, 3);
      if (!sources.length) return { status: controller.signal.aborted || !reachable ? 'unavailable' : 'no_results',
        summary: '', sources: [] };
      const summary = sources.map((source, index) =>
        `[${index + 1}] ${source.title}${source.date ? ` (${source.date})` : ''}: ${source.excerpt}`)
        .join('\n');
      return { status: 'ok', summary, sources };
    } catch {
      return { status: 'unavailable', summary: '', sources: [] };
    } finally { clearTimeout(timer); controller.abort(); }
  };

  const task = run();
  if (useCache) pending.set(key, task);
  try {
    const result = await task;
    if (useCache) {
      cached.set(key, { until: Date.now() + (result.status === 'ok' ? 15 * 60_000 : 30_000), result });
      if (cached.size > 60) cached.delete(cached.keys().next().value!);
    }
    return result;
  } finally { if (useCache) pending.delete(key); }
}
