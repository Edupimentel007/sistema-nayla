import type { Analytics } from './analytics.js';
import { assistantKnowledgeFor } from './assistantKnowledge.js';

type Service = { name: string; category: string; duration_minutes: number; price_cents: number };
export type AssistantBusiness = {
  name: string; slug: string; specialties: string[]; services: Service[];
  description?: string; address?: string; startTime?: string; endTime?: string;
  workdays?: number[]; slotInterval?: number;
};

const labels: Record<string, string> = {
  unhas: 'unhas', sobrancelhas: 'sobrancelhas', cilios: 'cílios', cabelos: 'cabelos',
  terapia_capilar: 'terapia capilar', maquiagem: 'maquiagem', depilacao: 'depilação',
  estetica_facial: 'estética facial', estetica_corporal: 'estética corporal',
  massagens: 'massagens', micropigmentacao: 'micropigmentação',
  bronzeamento: 'bronzeamento', podologia: 'podologia', outros: 'outros serviços',
};
const money = (cents: number) => new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL',
}).format(cents / 100);

const reais = (value: number) => new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL',
}).format(value);

/** Advice that can be grounded in this owner's analytics without waiting for a model. */
export function isBusinessAdviceQuestion(query: string): boolean {
  const asksForAction = /\b(como|dicas?|sugestoes?|ideias?|estrategias?|orientacoes?|planos?|recomendacoes?|o que fazer|por onde comecar)\b/.test(query);
  const businessGoal = /melhor|crescer|aument|elevar|atrair|captar|conquistar|fideliz|reter|retorno|ticket|precific|preco|divulg|marketing|agenda cheia|mais clientes|mais agendamentos|mais vendas|negocio/.test(query);
  const actionRequest = /\b(remarcar|reagendar|desmarcar|cancelar)\b/.test(query);
  return asksForAction && businessGoal && !actionRequest;
}

export function personalizedBusinessAdvice(query: string, business: AssistantBusiness,
  data: Analytics): string {
  const { period, overview, clients, appointments, services } = data;
  const window = `${period.from.split('-').reverse().join('/')} a ${period.to.split('-').reverse().join('/')}`;
  const intro = `Para ${business.name}, de ${window} (${period.days} dias): ${overview.bookings} reserva(s), ${overview.completed.current} atendimento(s) concluído(s), ${reais(overview.income.current)} em entradas registradas e ${overview.completed.current ? reais(overview.ticketAverage.current) : 'ticket médio ainda sem base'}. Entradas do Financeiro e valores dos atendimentos são medidas diferentes.`;
  const topService = [...services].sort((a, b) => b.bookings - a.bookings)[0];
  const namedAreas = assistantKnowledgeFor(query, []).specialtyGuides;
  const activeArea = business.specialties.includes(topService?.category || '') && topService?.bookings
    ? topService.category
    : business.services.find(item => business.specialties.includes(item.category))?.category
      || business.specialties[0];
  const guide = namedAreas.length
    ? namedAreas.filter(item => business.specialties.includes(item.area)).slice(0, 2)
    : assistantKnowledgeFor('', [activeArea]).specialtyGuides;
  const outsideArea = namedAreas.some(item => !business.specialties.includes(item.area))
    ? 'A área citada na pergunta não está selecionada no seu cadastro; os números abaixo se referem apenas ao seu espaço. '
    : '';
  const areaAdvice = `${outsideArea}${guide.length
    ? `Na sua área (${guide.map(item => item.label).join(' e ')}): ${guide.map(item => item.commercialAdvice).join(' ')}`
    : 'Descreva claramente cada serviço ativo, seu tempo e preço; registre preferências das clientes apenas quando forem úteis ao atendimento.'}`;
  const serviceEvidence = topService?.bookings
    ? `${topService.name} teve ${topService.bookings} reserva(s) e ${topService.completed} atendimento(s) concluído(s) neste período.`
    : 'Ainda não há reservas suficientes para identificar o serviço mais procurado.';
  const followup = clients.inactiveCount
    ? `Hoje há ${clients.inactiveCount} cliente(s) sem visita concluída há pelo menos 30 dias e sem reserva futura. Confira a lista em Clientes e convide individualmente quem aceitar contato, sem presumir que todas precisam do mesmo intervalo de retorno.`
    : clients.retention.eligible
      ? `${clients.retention.returned} de ${clients.retention.eligible} cliente(s) atendidas no período anterior voltaram neste período (${clients.retention.rate}%). Acompanhe essa taxa por mais de um período antes de mudar a rotina de relacionamento.`
      : 'Ainda não há base do período anterior para medir retorno. Conclua os atendimentos realizados na Agenda e acompanhe quantas clientes voltam.';
  const loss = appointments.denominator &&
    (appointments.cancellationRate || 0) + (appointments.noShowRate || 0) >= 15
    ? `Houve ${appointments.statuses.cancelled} cancelamento(s) e ${appointments.statuses.noShow} falta(s) em ${appointments.denominator} reserva(s). Confirme o horário com antecedência e observe se as perdas se concentram em algum dia.`
    : 'Acompanhe cancelamentos e faltas por dia da semana em Análises antes de alterar os horários.';
  const ticket = overview.completed.current
    ? `Compare os ${reais(overview.ticketAverage.current)} de ticket médio com preço, duração e materiais de cada serviço. O app não registra custo por serviço, então não é possível afirmar qual dá mais lucro.`
    : 'Para analisar ticket, primeiro marque os atendimentos realizados como concluídos. Depois compare preço, duração e materiais por serviço.';
  const finance = overview.expenses.current
    ? `Despesas registradas: ${reais(overview.expenses.current)}; saldo dos lançamentos: ${reais(overview.balance.current)}. ${overview.balance.current < 0 ? 'Revise primeiro os custos recorrentes e materiais antes de mudar preços; confirme se todas as entradas foram lançadas.' : 'Registre também gastos pequenos e compare a evolução com períodos semelhantes.'} O saldo registrado não representa lucro líquido.`
    : 'Não há despesas registradas neste período. Lance materiais, taxas e custos do espaço para não avaliar o negócio apenas pelas entradas.';
  const acquisition = `${serviceEvidence} Revise nome, duração e preço dos serviços ativos e divulgue seu link /agendar/${business.slug}. Teste horários adicionais para o serviço mais procurado somente se houver capacidade na agenda.`;

  const focus = /ticket|precific|preco|cobr|valor por atendimento/.test(query)
    ? [ticket, serviceEvidence, areaAdvice]
    : /retorn|fideliz|reter/.test(query)
      ? [followup, areaAdvice, appointments.statuses.cancelled || appointments.statuses.noShow ? loss : ticket]
      : /atrair|captar|conquistar|divulg|marketing|agenda cheia|mais clientes|mais agendamentos|mais vendas/.test(query)
        ? [acquisition, areaAdvice, followup]
        : [finance, followup, areaAdvice,
          appointments.statuses.cancelled || appointments.statuses.noShow ? loss
            : topService?.bookings ? acquisition : ticket];
  return `${intro}\n\n${focus.map((item, index) => `${index + 1}. ${item}`).join('\n')}\n\nAcompanhe o efeito em Análises após mais um período semelhante. Esses dados mostram procura e registros; não comprovam lucro, causa da mudança nem resultado futuro.`;
}

// These are product instructions and conservative business tips, not generated claims
// about a client's health or a particular procedure.
export function guidanceAnswer(query: string, business: AssistantBusiness): string | null {
  if (/(meus|minhas|quais|listar|lista|ofereco|disponiveis).{0,35}servic|servic.{0,35}(tenho|ofereco|disponiveis)/.test(query)) {
    return business.services.length
      ? `Seus serviços ativos são: ${business.services.map(item => `${item.name} (${money(item.price_cents)}, ${item.duration_minutes} min)`).join('; ')}. Para mudar preços, duração ou disponibilidade, abra Serviços.`
      : 'Você ainda não tem serviços ativos. Abra Serviços para escolher os atendimentos que deseja oferecer.';
  }
  if (/(minha|qual|quais).{0,25}(area|especialidade|atuacao)/.test(query) &&
    !/(dica|melhorar|atender|orient)/.test(query)) {
    return `No cadastro de ${business.name}, as áreas selecionadas são: ${business.specialties.map(item => labels[item] || item).join(', ')}. Você pode ajustá-las em Configurações; só os serviços ativos dessas áreas aparecem para suas clientes.`;
  }
  if (/link|compartilh|pagina de agend|agendament.{0,15}cliente/.test(query)) {
    return `Seu link de agendamento termina em /agendar/${business.slug}. Copie o endereço completo em Configurações e compartilhe com as clientes. Elas verão apenas os seus serviços ativos e horários disponíveis.`;
  }
  if (/como.{0,35}(cadastr|adicion|editar|alterar|desativ).{0,25}servic|preco.{0,15}servic|duracao.{0,15}servic/.test(query)) {
    return 'Abra Serviços para adicionar ou editar nome, área, preço, duração e disponibilidade. Em Configurações, confirme também suas áreas de atuação e horários; só os serviços ativos das áreas escolhidas aparecem no agendamento público.';
  }
  if (/whatsapp|lembrete|mensagem automat|notificac/.test(query)) {
    return 'Em Configurações, conecte o WhatsApp Business Cloud API do seu número e os modelos de mensagem aprovados pela Meta. Confira o consentimento da cliente. O app registra os avisos e mostra o status; sem configuração, não envia WhatsApp real. Os lembretes e notificações internas dependem das permissões do dispositivo.';
  }
  if (/\blogo\b|logotipo|\bminha marca\b|foto do perfil|icone do perfil/.test(query)) {
    return 'Você pode enviar sua logo no cadastro ou depois em Configurações. A imagem substitui a inicial no perfil e personaliza sua página de agendamento.';
  }
  if (/lancamento|lancar|entrada|despesa|financeiro|caixa/.test(query) &&
    /(como|onde|registr|aparec|atualiz|demor|cadast|erro)/.test(query)) {
    return 'Abra Financeiro, escolha entrada ou despesa, informe valor, descrição e data e toque em Salvar. O lançamento deve aparecer na lista assim que for confirmado. Confira a data e o filtro da página: a Visão geral abre em Hoje e pode mudar para 7, 30, 60 ou 90 dias. Se uma venda de serviço foi concluída, evite lançá-la de novo como entrada manual.';
  }
  if (/agenda|agendament|confirmar|concluir|falta/.test(query) &&
    /(como|onde|usar|marcar|alterar|cancelar|desmarcar)/.test(query)) {
    return 'Na Agenda você vê os horários, confirma e conclui atendimentos ou registra falta. A cliente pode alterar ou cancelar o próprio horário no espaço dela. Para um imprevisto seu, peça à Nayla para remarcar ou cancelar uma cliente: você escolhe o agendamento e confirma antes da alteração.';
  }
  if (/cliente|crm/.test(query) && /(como|onde|cadastr|anotac|historico|etiqueta)/.test(query)) {
    return 'Abra Clientes para ver histórico de visitas, telefone, observações e etiquetas. Essas informações pertencem ao seu espaço; use as anotações para acompanhar preferências de atendimento sem registrar dados sensíveis desnecessários.';
  }
  if (/grafico|analise|indicador|dashboard|visao geral|ticket medio/.test(query) &&
    /(como|onde|usar|ver|interpret)/.test(query)) {
    return 'Abra Visão geral para acompanhar os números do período escolhido e Análises para gráficos de caixa, agenda, clientes e serviços. O ticket médio usa os valores dos atendimentos concluídos; entradas manuais não entram nessa média. Posso explicar cada indicador com os dados do seu espaço.';
  }
  if (/plano|assinatura|teste gratis|30 dias gratis|cobranca/.test(query)) {
    return 'Seu primeiro mês de teste é grátis e começa sem cartão. Para acompanhar o prazo ou escolher o plano mensal ou anual, abra Planos no app. Pagamentos são concluídos no ambiente seguro do provedor; a Nayla não pede dados do cartão no chat.';
  }
  if (/quanto cobrar|precific|preco justo|definir.{0,15}preco/.test(query)) {
    return 'Para precificar um serviço, some materiais e descartáveis, tempo de trabalho, custos fixos proporcionais e taxas; depois defina a margem desejada. Compare também a demanda e o posicionamento na sua região. O preço atual no app é seu cadastro, não uma estimativa de custo ou lucro. Posso ajudar a analisar ticket médio e procura dos seus serviços.';
  }
  if (/divulg|marketing|conseguir cliente|atrair cliente|mais agendamento/.test(query)) {
    return `Divulgue o link /agendar/${business.slug} nos seus canais e mostre resultados reais com autorização das clientes. Deixe serviços, duração e preços claros; acompanhe em Análises quais atendimentos trazem retorno e ajuste seus horários conforme a procura.`;
  }

  const areaTips: Array<[string, RegExp, string]> = [
    ['unhas', /unha|manicur|pedicur|esmalta|alongamento|nail art/, 'Para unhas, detalhe a duração de cada serviço, o que está incluído e a frequência de manutenção que você oferece. Registre preferências de formato e cor para personalizar o retorno.'],
    ['sobrancelhas', /sobrancelha|henna|brow lamination/, 'Para sobrancelhas, alinhe o resultado esperado antes da reserva, explique o que está incluído e registre preferências para o próximo atendimento.'],
    ['cilios', /cilio|lash|extensao/, 'Para cílios, separe serviços de aplicação e manutenção, informe a duração de cada um e entregue orientações de uso dos produtos conforme o fabricante.'],
    ['cabelos', /cabelo|mecha|colorac|escova/, 'Para cabelos, confirme comprimento, histórico do serviço e expectativa antes de reservar procedimentos longos. Deixe duração, preço e possíveis etapas extras claros.'],
    ['terapia_capilar', /capilar/, 'Para terapia capilar, deixe claro o objetivo comercial de cada serviço, duração, produtos utilizados e necessidade de retorno. Não apresente o serviço como diagnóstico.'],
    ['maquiagem', /maquiagem|make/, 'Para maquiagem, confirme ocasião, horário, referências e duração com antecedência. Registre preferências de acabamento e reserve tempo para preparação entre atendimentos.'],
    ['depilacao', /depilac|cera|linha/, 'Para depilação, diferencie cada área atendida e seu tempo de execução. Informe preparo e cuidados de acordo com o método e os produtos usados.'],
    ['estetica_facial', /facial|pele|limpeza de pele|hidratac/, 'Para estética facial, descreva o que o atendimento inclui, duração e produtos utilizados. Defina expectativas realistas e registre preferências para acompanhar o retorno.'],
    ['estetica_corporal', /corporal|drenagem|modeladora/, 'Para serviços corporais, descreva objetivo, duração e o que está incluído em cada sessão. Evite promessas de resultado clínico ao divulgar.'],
    ['massagens', /massagem/, 'Para massagens, apresente as modalidades separadamente, com duração, ambiente e preço. Deixe um intervalo entre sessões para preparar o espaço.'],
    ['micropigmentacao', /micropigmentac/, 'Para micropigmentação, informe etapas, duração, valor de retorno e orientações do produto antes da reserva. Mantenha os registros de consentimento e biossegurança exigidos para a sua atividade.'],
    ['bronzeamento', /bronzeamento|autobronzeador/, 'Para bronzeamento, esclareça método, duração, preparo e manutenção de acordo com o fabricante. Não prometa efeitos que o produto não oferece.'],
    ['podologia', /podolog|cuidados dos pes/, 'Para podologia, diferencie os serviços oferecidos, reserve tempo suficiente e siga as exigências de biossegurança da sua atividade.'],
  ];
  if (/(como|dica|orient|melhorar|trabalh|atend|cuidad|tecnic|resultado|cliente)/.test(query)) {
    const match = areaTips.find(([, pattern]) => pattern.test(query));
    if (match) return `${business.specialties.includes(match[0]) ? '' : `Essa área (${labels[match[0]]}) não está selecionada no seu cadastro. `}${match[2]} Para questões de saúde ou segurança clínica, procure um profissional habilitado.`;
    if (/minha area|meu trabalho|meus servicos|meu negocio/.test(query)) {
      const first = business.specialties[0];
      const relevant = areaTips.find(([category]) => category === first);
      return `${relevant?.[2] || 'Confirme duração, materiais, preço e expectativa antes de cada atendimento.'} Em Análises, compare a procura e o retorno das clientes para decidir o que ajustar.`;
    }
  }
  return null;
}
