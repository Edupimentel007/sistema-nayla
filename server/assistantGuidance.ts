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
  const text = query.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const asksForAction = /\b(como|dicas?|sugestoes?|ideias?|estrategias?|orientacoes?|planos?|recomendacoes?|o que fazer|por onde comecar|me ajude|quero|preciso|poderia|pesquis[ae]?|busqu[ea]?|fontes?)\b/.test(text)
    || /tendenc|novidad|\bem alta\b/.test(text);
  const businessGoal = /melhor|crescer|aument|elevar|atrair|captar|conquistar|fideliz|reter|retorno|ticket|precific|preco|divulg|marketing|agenda cheia|mais clientes|mais agendamentos|mais vendas|negocio|destac|diferenc|posicion|concorr|referencia|reconhecid|clientela|tendenc|novidad|\bem alta\b|\bmeu ramo\b|\bmeu nicho\b/.test(text);
  const actionRequest = /\b(remarcar|reagendar|desmarcar|cancelar)\b/.test(text);
  return asksForAction && businessGoal && !actionRequest;
}

const differentiationByArea: Record<string, { showcase: string; experience: string }> = {
  unhas: {
    showcase: 'Monte um portfólio por estilo e ocasião; se oferecer alongamento, diferencie aplicação, manutenção e remoção com tempo e preço próprios.',
    experience: 'Anote, com permissão, formato e cores preferidos; na saída, sugira a próxima reserva conforme o serviço realizado e a vontade da cliente.',
  },
  sobrancelhas: {
    showcase: 'Mostre exemplos autorizados de acabamentos naturais e marcados; explique a diferença entre design simples, coloração e henna somente se fizer esses serviços.',
    experience: 'Alinhe formato esperado antes de começar e registre a preferência para que o próximo atendimento seja consistente.',
  },
  cilios: {
    showcase: 'Organize fotos autorizadas por efeito e modalidade; se fizer extensão, separe aplicação, manutenção e remoção no menu.',
    experience: 'Confirme o efeito desejado, explique o que está incluído e deixe claro o tempo de cada modalidade antes da reserva.',
  },
  cabelos: {
    showcase: 'Separe no portfólio corte, cor e penteado que realmente realiza; mostre escopo e critérios de orçamento para serviços longos.',
    experience: 'Na consulta inicial, alinhe referências, tempo e possíveis etapas extras para reduzir surpresas no dia.',
  },
  terapia_capilar: {
    showcase: 'Explique a experiência cosmética de cada serviço com etapas e produtos, sem prometer diagnóstico ou tratamento clínico.',
    experience: 'Registre preferências de atendimento e apresente uma opção de retorno somente quando fizer sentido para a cliente.',
  },
  maquiagem: {
    showcase: 'Organize trabalhos autorizados por ocasião, como evento, noiva ou maquiagem social, conforme o que você realmente oferece.',
    experience: 'Confirme horário em que a cliente precisa estar pronta, referência, teste e deslocamento antes de fechar o valor.',
  },
  depilacao: {
    showcase: 'Mostre um menu simples por área e método que você atende; informe duração e valor total de combinações possíveis.',
    experience: 'Facilite uma reserva discreta, confirme preferências de privacidade e comunique preparo conforme os produtos utilizados.',
  },
  estetica_facial: {
    showcase: 'Descreva o objetivo estético, etapas e duração de cada serviço sem prometer resultado clínico ou universal.',
    experience: 'Explique o que está incluído e peça retorno sobre a experiência; encaminhe questões clínicas a profissional habilitado.',
  },
  estetica_corporal: {
    showcase: 'Diferencie serviços por experiência, tempo e o que cada sessão inclui; evite promessas de medidas ou resultados médicos.',
    experience: 'Apresente condições de sessões ou pacotes com preço transparente e respeite privacidade e consentimento.',
  },
  massagens: {
    showcase: 'Separe modalidades de bem-estar por duração, ambiente e preço para a cliente escolher com segurança.',
    experience: 'Confirme conforto e preferências antes da sessão e reserve tempo de preparo entre clientes.',
  },
  micropigmentacao: {
    showcase: 'Mostre portfólio autorizado por modalidade e informe etapas, avaliação, valor de retoque e escopo.',
    experience: 'Alinhe expectativa e consentimento antes da reserva e siga os requisitos da sua atividade.',
  },
  bronzeamento: {
    showcase: 'Apresente o método cosmético, preparo e duração, com exemplos autorizados e sem prometer proteção solar.',
    experience: 'Pergunte a data do evento para orientar o agendamento conforme as instruções do produto usado.',
  },
  podologia: {
    showcase: 'Descreva o escopo dos cuidados que oferece e o tempo de cada modalidade, sem apresentar o serviço como diagnóstico.',
    experience: 'Mantenha atendimento reservado e requisitos de biossegurança; encaminhe sinais clínicos a profissional habilitado.',
  },
  outros: {
    showcase: 'Escolha um serviço que você realmente faz e explique claramente para quem é, o que inclui, duração e preço.',
    experience: 'Peça feedback sobre atendimento e facilidade da reserva; ajuste a descrição quando surgirem dúvidas repetidas.',
  },
};

export function personalizedBusinessAdvice(query: string, business: AssistantBusiness,
  data: Analytics): string {
  const normalizedQuery = query.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
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
  const focusedArea = guide[0]?.area || activeArea || 'outros';
  const focusedLabel = guide[0]?.label || labels[focusedArea] || 'seu ramo';
  const examples = differentiationByArea[focusedArea] || differentiationByArea.outros;
  const offerings = business.services.filter(item => item.category === focusedArea).slice(0, 3);
  const areaTopService = [...services].filter(item => item.category === focusedArea)
    .sort((a, b) => b.bookings - a.bookings)[0];
  if (/tendenc|novidad|\bem alta\b/.test(normalizedQuery)) {
    return `Sobre novidades em ${focusedLabel}: sem uma fonte externa atual nesta resposta, não posso afirmar o que está em alta no mercado. ${outsideArea}\n\n`
      + `1. Observe a procura real: nos ${period.days} dias de ${window}, ${areaTopService?.bookings ? `${areaTopService.name} teve ${areaTopService.bookings} reserva(s)` : 'ainda não há reservas suficientes dessa área para apontar uma preferência das suas clientes'}.\n`
      + `2. Escolha uma ideia pequena para testar, respeitando sua formação e os serviços que realmente oferece. ${examples.showcase}\n`
      + `3. Apresente escopo, duração e preço antes de divulgar a novidade; compare reservas, cancelamentos e retorno no próximo período semelhante. Procura local não comprova que uma técnica seja tendência geral.`;
  }
  if (/destac|diferenc|posicion|concorr|referencia|reconhecid/.test(normalizedQuery)) {
    if (/\bmais\s+(?:algumas?\s+)?(?:dicas?|ideias?|sugestoes?)\b|\bo que mais\b|\balgo mais\b/.test(normalizedQuery)) {
      const serviceName = offerings[0]?.name || 'um serviço que você oferece';
      return `Mais três ideias para ${focusedLabel}, além da vitrine e da experiência que comentei:\n\n`
        + `1. Responda uma dúvida recorrente sobre ${serviceName} em uma publicação curta: mostre o que inclui, o tempo e o preço cadastrado, com convite para reservar pelo seu link.\n`
        + `2. Faça uma parceria de indicação com uma profissional complementar da sua região. Combine uma apresentação clara dos serviços, sem compartilhar dados ou contatos das clientes.\n`
        + `3. Ajuste a execução: ${guide[0]?.workflow || 'confirme expectativa e duração antes da reserva e deixe uma margem realista entre atendimentos.'}\n\n`
        + `Em Análises, acompanhe reservas e atendimentos concluídos de ${serviceName} nos próximos ${period.days} dias; mude uma ação por vez para entender o que ajuda.`;
    }
    const catalogEvidence = offerings.length
      ? `Entre os seus serviços estão ${offerings.map(item => `${item.name} (${item.duration_minutes} min, ${money(item.price_cents)})`).join(', ')}. Escolha um deles para começar a campanha.`
      : `Cadastre primeiro uma modalidade dessa área que você realmente oferece, com preço e duração claros.`;
    const serviceEvidence = areaTopService?.bookings
      ? `Seu serviço mais reservado nessa área foi ${areaTopService.name}: ${areaTopService.bookings} reserva(s), ${areaTopService.completed} concluída(s).`
      : 'Ainda não há reservas suficientes para escolher um serviço pelo histórico; comece pelo que você domina e consegue atender bem.';
    const returnEvidence = clients.retention.eligible
      ? `Das ${clients.retention.eligible} clientes do período anterior, ${clients.retention.returned} voltaram (${clients.retention.rate}%).`
      : 'Ainda não há base para medir retorno de clientes.';
    return `Para se destacar em ${focusedLabel}, transforme a qualidade do seu atendimento em uma oferta fácil de entender e reservar. ${outsideArea}\n\n`
      + `1. Escolha o diferencial: ${examples.showcase} ${catalogEvidence}\n`
      + `2. Mostre a experiência: Publique fotos ou depoimentos reais apenas com autorização. ${examples.experience}\n`
      + `3. Facilite a decisão: Deixe seu link /agendar/${business.slug} visível na bio e nas mensagens, com nome, duração e preço dos serviços ativos. Convide a cliente satisfeita a indicar seu trabalho sem oferecer promessas de resultado.\n\n`
      + `Como medir: nos ${period.days} dias de ${window}, houve ${overview.bookings} reserva(s) e ${overview.completed.current} atendimento(s) concluído(s). ${serviceEvidence} ${returnEvidence} Teste uma melhoria por vez durante o próximo período semelhante e acompanhe reservas do serviço escolhido e retorno em Análises; esses registros não provam sozinhos a causa de uma mudança.`;
  }
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

  const focus = /ticket|precific|preco|cobr|valor por atendimento/.test(normalizedQuery)
    ? [ticket, serviceEvidence, areaAdvice]
    : /retorn|fideliz|reter/.test(normalizedQuery)
      ? [followup, areaAdvice, appointments.statuses.cancelled || appointments.statuses.noShow ? loss : ticket]
      : /atrair|captar|conquistar|divulg|marketing|agenda cheia|mais clientes|mais agendamentos|mais vendas/.test(normalizedQuery)
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
    return 'Crie sua conta sem cartão e acompanhe o estado do acesso em Meu acesso. A equipe Nayla decide quando liberar os 30 dias iniciais, uma única vez por profissional. Depois, combine a renovação diretamente com a equipe; a cobrança acontece fora do app e a liberação é manual. A Nayla não pede dados de cartão no chat.';
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
