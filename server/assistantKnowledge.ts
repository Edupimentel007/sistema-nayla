import { specialtyValues, type Specialty } from './catalog.js';

/** Curated product and business context for the language model, not model training data. */
export type SpecialtyGuide = {
  area: Specialty;
  label: string;
  terms: readonly string[];
  scope: string;
  workflow: string;
  commercialAdvice: string;
  metrics: string;
};

export type AppGuide = {
  id: string;
  title: string;
  terms: readonly string[];
  path: string;
  instructions: string;
  caveat?: string;
};

const specialtyGuides: SpecialtyGuide[] = [
  {
    area: 'unhas', label: 'Unhas', terms: ['unha', 'manicure', 'pedicure', 'esmalta', 'alongamento', 'nail art', 'blindagem'],
    scope: 'Manicure, pedicure, esmaltação, alongamento, manutenção, remoção e nail art são reservas diferentes; a profissional escolhe quais oferece.',
    workflow: 'Separe aplicação, manutenção e remoção no catálogo com duração e preço próprios. Confirme se haverá decoração ou outro adicional antes de fechar o horário e reserve tempo de preparação entre clientes.',
    commercialAdvice: 'Registre preferências de formato, cor e acabamento; convide a cliente a agendar o retorno no intervalo que fizer sentido para o serviço e para ela. Apresente o valor de adicionais antes de começar.',
    metrics: 'Compare procura, tempo ocupado e retorno por tipo de serviço; não trate preço do atendimento como lucro sem considerar materiais e tempo.',
  },
  {
    area: 'sobrancelhas', label: 'Sobrancelhas', terms: ['sobrancelha', 'design de sobrancelhas', 'henna', 'brow lamination', 'brow'],
    scope: 'Design, coloração, henna e brow lamination são serviços distintos; micropigmentação deve ter descrição, preço e tempo específicos.',
    workflow: 'Alinhe referências e resultado esperado antes do atendimento. Diferencie manutenção simples de serviços com coloração e deixe claro o que o preço inclui.',
    commercialAdvice: 'Guarde preferências estéticas da cliente, com consentimento, e comunique com clareza a possibilidade de retorno ou de combinar serviços.',
    metrics: 'Acompanhe repetição de clientes e procura por modalidade para ajustar duração, horários e apresentação do menu.',
  },
  {
    area: 'cilios', label: 'Cílios', terms: ['cilio', 'lash', 'extensao', 'volume russo', 'volume brasileiro', 'fio a fio'],
    scope: 'Aplicação, manutenção, remoção, coloração e lash lifting precisam ser diferenciados no menu.',
    workflow: 'Confirme o estilo desejado, a modalidade, a duração prevista e se a cliente busca aplicação ou manutenção; mantenha uma folga realista entre atendimentos longos.',
    commercialAdvice: 'Explique o que está incluído no preço e nas manutenções. Registre preferências de efeito para facilitar o retorno, sem prometer duração idêntica para todas as clientes.',
    metrics: 'Compare aplicações novas, manutenções e cancelamentos por serviço para ajustar agenda e comunicação.',
  },
  {
    area: 'cabelos', label: 'Cabelos', terms: ['cabelo', 'corte', 'escova', 'penteado', 'coloracao', 'mecha', 'raiz', 'progressiva'],
    scope: 'Corte, escova, penteado, coloração, retoque e mechas variam muito de tempo e material.',
    workflow: 'Antes de reservar um serviço longo, confirme comprimento, objetivo, referências e histórico de serviços informado pela cliente. Descreva se uma avaliação prévia ou etapa adicional altera o preço e o tempo.',
    commercialAdvice: 'Use descrições e faixas de tempo realistas; evite um preço único para trabalhos que dependem de avaliação. Convide a cliente a reservar manutenção quando for apropriado.',
    metrics: 'Compare receita, horas ocupadas, repetição e cancelamentos por tipo de atendimento; receita bruta não mede margem.',
  },
  {
    area: 'terapia_capilar', label: 'Terapia capilar', terms: ['terapia capilar', 'capilar', 'hidratacao capilar', 'reconstrucao capilar', 'spa capilar'],
    scope: 'Avaliação cosmética, hidratação, nutrição, reconstrução e spa capilar devem ser descritos pelo que a profissional realmente oferece.',
    workflow: 'Explique objetivos cosméticos, produtos utilizados, tempo e etapas; documente preferências e o serviço anterior quando a cliente retornar.',
    commercialAdvice: 'Monte planos de retorno apenas quando forem úteis e transparentes. Não apresente atendimento estético como diagnóstico ou tratamento de doença, queda ou lesão.',
    metrics: 'Acompanhe retorno, duração efetiva e adesão às modalidades, sem inferir eficácia clínica a partir de vendas ou agendamentos.',
  },
  {
    area: 'maquiagem', label: 'Maquiagem', terms: ['maquiagem', 'make', 'noiva', 'automaquiagem'],
    scope: 'Maquiagem social, para evento, noiva, expressa e aula de automaquiagem exigem escopos e tempos diferentes.',
    workflow: 'Confirme ocasião, horário em que a cliente precisa estar pronta, local, referências e número de pessoas. Diferencie teste, deslocamento e retoques quando oferecidos.',
    commercialAdvice: 'Mostre portfólio autorizado e deixe claro o que cada pacote inclui. Proteja horários de eventos com tempo suficiente para preparação e deslocamento.',
    metrics: 'Compare sazonalidade de eventos, antecedência das reservas, receita por modalidade e tempo ocupado.',
  },
  {
    area: 'depilacao', label: 'Depilação', terms: ['depilacao', 'cera', 'depilacao com linha', 'buco', 'virilha'],
    scope: 'Separe área atendida e método usado; buço, axilas, pernas, virilha e depilação facial têm durações próprias.',
    workflow: 'Confirme área, método, preferências de privacidade e tempo antes de reservar. Comunique orientações de produto e procedimento conforme a formação da profissional e instruções do fabricante.',
    commercialAdvice: 'Facilite a combinação de áreas quando houver tempo disponível, com valor total explícito. Não assuma um intervalo fixo de retorno para todas as clientes.',
    metrics: 'Analise demanda por área, pacotes escolhidos, ocupação e repetição sem usar dados íntimos em mensagens ou relatórios desnecessários.',
  },
  {
    area: 'estetica_facial', label: 'Estética facial', terms: ['estetica facial', 'facial', 'limpeza de pele', 'mascara facial', 'pele'],
    scope: 'Limpeza de pele, hidratação, esfoliação, máscara e massagem facial devem ter descrições distintas.',
    workflow: 'Descreva etapas gerais, duração, produtos e o que está incluído. Alinhe a expectativa estética da cliente e registre preferências relevantes sem fazer diagnóstico.',
    commercialAdvice: 'Comunique resultados possíveis com prudência e oriente a cliente a procurar profissional de saúde habilitado para sintomas ou condições clínicas.',
    metrics: 'Compare serviços iniciais e retornos, tempo de atendimento e avaliações de experiência; vendas não comprovam eficácia.',
  },
  {
    area: 'estetica_corporal', label: 'Estética corporal', terms: ['estetica corporal', 'corporal', 'esfoliacao corporal', 'drenagem', 'modeladora'],
    scope: 'Esfoliação, hidratação, drenagem manual e massagem modeladora são serviços separados.',
    workflow: 'Descreva objetivo estético, tempo, local e o que cada sessão inclui. Combine o número de sessões somente com informação clara de preço e condições.',
    commercialAdvice: 'Evite prometer medidas, cura ou mudanças clínicas. Respeite privacidade, consentimento e limites da formação profissional.',
    metrics: 'Veja retorno, ocupação e receita por sessão ou pacote; não confunda esses números com resultados de saúde.',
  },
  {
    area: 'massagens', label: 'Massagens', terms: ['massagem', 'relaxante', 'pedras quentes', 'spa dos pes'],
    scope: 'Massagem relaxante, localizada, com pedras quentes e spa dos pés devem ter tempo e preço próprios.',
    workflow: 'Confirme modalidade, duração, ambiente e preferência de conforto antes de reservar; inclua tempo de arrumação entre sessões.',
    commercialAdvice: 'Explique que o serviço é de bem-estar conforme sua qualificação. Não apresente massagens como tratamento de doenças nem ofereça orientação clínica.',
    metrics: 'Acompanhe horários mais procurados, repetição, cancelamentos e receita por hora de agenda.',
  },
  {
    area: 'micropigmentacao', label: 'Micropigmentação', terms: ['micropigmentacao', 'microblading', 'pigmentacao labial', 'pigmentacao dos olhos'],
    scope: 'Sobrancelhas, lábios, olhos e retoque são modalidades com etapas, valores e duração próprios.',
    workflow: 'Antes da reserva, explique escopo, avaliação, valor e política de retoque. Mantenha consentimentos e requisitos locais de habilitação, higiene e biossegurança.',
    commercialAdvice: 'Use portfólio autorizado e expectativas realistas. Não dê no chat instruções técnicas invasivas nem aconselhamento para complicações; encaminhe questões clínicas a profissional habilitado.',
    metrics: 'Compare procura por modalidade, taxa de retoque, ocupação e cancelamentos sem divulgar dados pessoais das clientes.',
  },
  {
    area: 'bronzeamento', label: 'Bronzeamento', terms: ['bronzeamento', 'autobronzeador', 'bronze a jato'],
    scope: 'Bronzeamento a jato, aplicação de autobronzeador e esfoliação prévia podem ser serviços diferentes.',
    workflow: 'Descreva produto, tempo, preparo e resultado esperado de acordo com as instruções do fabricante; confirme o horário de eventos antes de agendar.',
    commercialAdvice: 'Diferencie serviço cosmético de exposição UV e não prometa proteção solar ou efeito de saúde. Informe o que está incluído no preço.',
    metrics: 'Acompanhe sazonalidade, agendamentos antes de eventos, repetição e procura por serviços combinados.',
  },
  {
    area: 'podologia', label: 'Podologia', terms: ['podologia', 'podologo', 'pes', 'unhas dos pes'],
    scope: 'Cuidados básicos dos pés, corte técnico de unhas e hidratação precisam de descrições e durações próprias.',
    workflow: 'Informe o escopo do atendimento, agende tempo suficiente e siga as exigências locais de formação e biossegurança.',
    commercialAdvice: 'Não diagnostique nem oriente tratamento de infecção, ferida ou doença pelo chat; encaminhe queixas clínicas a profissional habilitado.',
    metrics: 'Compare serviços agendados, retornos, cancelamentos e tempo ocupado, preservando a privacidade da cliente.',
  },
  {
    area: 'outros', label: 'Outros serviços de beleza', terms: ['outro servico', 'outra especialidade', 'personalizado'],
    scope: 'A profissional pode cadastrar manualmente serviços não cirúrgicos de beleza que não constam dos modelos.',
    workflow: 'Cadastre nome claro, descrição do que inclui, duração, preço e disponibilidade de cada serviço; mantenha apenas os que realmente oferece.',
    commercialAdvice: 'Explique requisitos e expectativas sem prometer resultados médicos. Para atividades regulamentadas, respeite a formação e as normas aplicáveis.',
    metrics: 'Observe procura, retorno, receita e ocupação antes de expandir ou retirar uma modalidade.',
  },
];

const appGuides: AppGuide[] = [
  {
    id: 'primeiros_passos', title: 'Primeiros passos', terms: ['comecar', 'primeiros passos', 'usar o app', 'como funciona', 'me ajuda', 'ajuda', 'recursos', 'funcionalidades'],
    path: '/app/boas-vindas',
    instructions: 'Após cadastrar o espaço, escolha suas áreas e serviços, revise preços e durações em Serviços, configure dias e horário de atendimento em Configurações e compartilhe o link público. A tela Plano e cobrança apresenta o teste e os planos.',
  },
  {
    id: 'visao_geral', title: 'Visão geral', terms: ['visao geral', 'painel', 'dashboard', 'resumo', 'filtro', 'periodo', 'hoje'],
    path: '/app',
    instructions: 'Ao abrir, a Visão geral mostra Hoje. É possível escolher 7, 30, 60 ou 90 dias para ver métricas do período. Use Agenda e Financeiro para investigar os registros por trás de um número.',
    caveat: 'Faturamento soma entradas registradas; atendimento futuro ainda não é receita.',
  },
  {
    id: 'agenda', title: 'Agenda da profissional', terms: ['agenda', 'agendamento', 'horario', 'marcar cliente', 'confirmar', 'concluir', 'falta', 'cancelar'],
    path: '/app/agenda',
    instructions: 'Escolha a data ou navegue pelos dias, filtre por situação e use Novo agendamento para reservar. Nos atendimentos, confirme, conclua ou registre ausência. Ao cancelar por imprevisto, revise a cliente e o motivo antes de confirmar. A Agenda atualiza os agendamentos recebidos do espaço da cliente.',
    caveat: 'Concluir atendimento gera receita automática; alterar uma reserva não deve gerar cobrança duplicada.',
  },
  {
    id: 'clientes', title: 'Clientes e CRM', terms: ['cliente', 'crm', 'contato', 'cpf', 'telefone', 'etiqueta', 'tag', 'observacao', 'ausente', 'nao voltou'],
    path: '/app/clientes',
    instructions: 'Busque por nome, telefone ou tag; filtre clientes sem voltar há 30 dias. Abra a ficha para atualizar contato, tags e observações. Nova cliente permite cadastro manual; clientes também se cadastram pelo link de agendamento.',
    caveat: 'Registre somente observações necessárias ao atendimento. Não compartilhe CPF, telefone ou dados da cliente com terceiros pelo chat.',
  },
  {
    id: 'financeiro', title: 'Financeiro', terms: ['financeiro', 'entrada', 'despesa', 'saldo', 'faturamento', 'lancamento', 'caixa', 'receita', 'gasto'],
    path: '/app/financeiro',
    instructions: 'Em Novo lançamento, escolha Entrada ou Despesa, informe descrição, valor e data e salve. O histórico e os totais seguem o filtro de 7, 30, 60 ou 90 dias. Atendimentos concluídos criam entradas automáticas.',
    caveat: 'Se um lançamento não aparecer no filtro, confira a data. Evite lançar manualmente a mesma venda já registrada ao concluir o atendimento. Saldo não equivale a lucro quando faltam custos.',
  },
  {
    id: 'analises', title: 'Análises e indicadores', terms: ['analise', 'grafico', 'indicador', 'ticket medio', 'retencao', 'fidelizacao', 'servico mais', 'comparar'],
    path: '/app/analises',
    instructions: 'Escolha o período e navegue pelas abas Visão geral, Clientes, Ticket médio, Serviços, Financeiro e Agenda. Os gráficos trazem valores por dia, explicação do indicador e uma dica prática. Peça à Nayla para explicar os dados atuais do seu espaço.',
    caveat: 'Ticket médio usa valores de atendimentos concluídos, não lançamentos manuais. Receita por serviço não é lucro ou margem sem custos.',
  },
  {
    id: 'servicos', title: 'Serviços e áreas', terms: ['servico', 'especialidade', 'area de atuacao', 'preco', 'duracao', 'ativar', 'desativar', 'arquivar'],
    path: '/app/servicos',
    instructions: 'Adicione ou edite nome, área, descrição, preço, duração e estado ativo de cada serviço. Também é possível arquivar. Em Configurações, ajuste suas áreas de atuação.',
    caveat: 'Na página pública aparecem somente serviços ativos de áreas selecionadas pela profissional. Os modelos do catálogo são sugestões editáveis, não uma lista obrigatória.',
  },
  {
    id: 'agendamento_cliente', title: 'Página da cliente', terms: ['link', 'agendar online', 'pagina publica', 'pagina da cliente', 'pagina de agendamento', 'agendamento da cliente', 'cliente agenda', 'cliente remarcar', 'cliente cancela', 'meus agendamentos'],
    path: '/app/configuracoes',
    instructions: 'Copie ou compartilhe seu link em Configurações. Pelo link, a cliente cria conta, vê os serviços ativos e horários disponíveis e marca um atendimento. Em Meus agendamentos, pode alterar dia, horário ou serviço e cancelar antes do atendimento.',
    caveat: 'Mudanças da cliente atualizam a agenda da profissional e geram avisos no app. WhatsApp real depende de configuração e consentimento.',
  },
  {
    id: 'nayla', title: 'Assistente Nayla', terms: ['nayla', 'assistente', 'chat', 'inteligencia artificial', 'ia', 'perguntar', 'remarcar cliente'],
    path: '/app/assistente',
    instructions: 'Pergunte sobre sua agenda, faturamento, clientes, serviços, indicadores ou sua área de atuação. Para pedir remarcação ou cancelamento por imprevisto, escolha o agendamento exato no cartão e confirme a ação; o chat sozinho não altera dados.',
    caveat: 'A Nayla usa dados do espaço autenticado. O envio de um aviso pelo WhatsApp depende de consentimento da cliente e da configuração da profissional.',
  },
  {
    id: 'configuracoes', title: 'Configurações do espaço', terms: ['configuracao', 'disponibilidade', 'dia de atendimento', 'horario de atendimento', 'endereco', 'nome do espaco', 'telefone do espaco'],
    path: '/app/configuracoes',
    instructions: 'Edite nome, descrição, telefone, endereço, áreas de atuação, dias e horários de atendimento e intervalo entre horários. Salve para refletir as opções na página pública.',
  },
  {
    id: 'logo', title: 'Logo e identidade', terms: ['logo', 'logotipo', 'marca', 'icone do perfil', 'foto do perfil'],
    path: '/app/configuracoes',
    instructions: 'A profissional pode enviar a logo no cadastro ou alterá-la em Configurações. A imagem aparece no perfil e na página de agendamento.',
  },
  {
    id: 'whatsapp', title: 'WhatsApp e notificações', terms: ['whatsapp', 'mensagem automatica', 'notificacao', 'lembrete', 'meta', 'responder urgente'],
    path: '/app/configuracoes',
    instructions: 'Configurações mostra a conexão WhatsApp da própria profissional e o histórico de mensagens. Para envio automático real do número dela, é necessária a Cloud API da Meta, modelos aprovados e consentimento da cliente. Sem isso, o app registra o aviso, mas não envia WhatsApp real. Os lembretes são preparados 24 horas antes, no dia e uma hora antes.',
    caveat: '“RESPONDER URGENTE” é texto na prévia e no histórico; a Cloud API não aplica etiqueta nativa ao WhatsApp. O app não confirma entrega só porque a Meta aceitou o envio.',
  },
  {
    id: 'planos', title: 'Teste e acesso', terms: ['plano', 'assinatura', 'teste gratis', 'primeiro mes', 'cobranca', 'mercado pago', 'pix', 'cartao'],
    path: '/app/boas-vindas',
    instructions: 'O cadastro da profissional começa aguardando liberação. A equipe Nayla pode conceder 30 dias iniciais sem cartão, uma única vez para a identidade cadastrada. O estado e a data final aparecem em Meu acesso. Depois disso, a profissional combina a renovação com a equipe fora do app; o super admin concede ou bloqueia o acesso manualmente.',
    caveat: 'A Nayla não oferece checkout, Pix ou cobrança automática no app e não confirma pagamentos por conta própria. Nunca solicite dados de cartão ou banco no chat.',
  },
  {
    id: 'conta', title: 'Acesso e conta', terms: ['login', 'senha', 'google', 'manter conectado', 'sair', 'conta', 'cadastro'],
    path: '/entrar',
    instructions: 'Profissional e cliente têm acessos separados. O cadastro com senha funciona; continuar com Google aparece quando a integração estiver configurada. A opção Manter conectado preserva a sessão por até sete dias; depois é necessário entrar novamente.',
    caveat: 'Nunca peça senha, código de acesso, token ou dados bancários no chat.',
  },
  {
    id: 'tema', title: 'Tema e uso no celular', terms: ['tema escuro', 'tema claro', 'celular', 'mobile', 'instalar app', 'pwa'],
    path: '/app',
    instructions: 'O botão de tema alterna entre claro e escuro. A Nayla funciona no navegador do celular, pode ser instalada como PWA e tem projetos Android e iOS para pacotes nativos.',
    caveat: 'Agenda, CRM, Financeiro e Nayla precisam de conexão com a API.',
  },
];

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function hasTerm(query: string, term: string): boolean {
  const normalized = normalize(term);
  // Short stems should not match inside unrelated words (for example, "ia" in "maquiagem").
  return normalized.length > 3 ? query.includes(normalized) :
    new RegExp(`(^|\\W)${normalized}($|\\W)`).test(query);
}

export type AssistantKnowledge = {
  registeredAreas: string[];
  specialtyGuides: Array<Omit<SpecialtyGuide, 'terms'> & { registered: boolean }>;
  appGuides: Array<Omit<AppGuide, 'terms'>>;
  boundaries: string[];
};

/** Selects a small, relevant excerpt; nothing here authorizes changes to customer data. */
export function assistantKnowledgeFor(query: string, selectedSpecialties: readonly string[]): AssistantKnowledge {
  const normalized = normalize(query);
  const registered = specialtyGuides.filter(item => selectedSpecialties.includes(item.area));
  const explicit = specialtyGuides.filter(item => item.terms.some(term => hasTerm(normalized, term)));
  const chosen = explicit.length ? explicit.slice(0, 3) : registered.slice(0, 3);
  const matchedApp = appGuides.map((item, index) => ({
    item, index,
    score: item.terms.filter(term => hasTerm(normalized, term))
      .reduce((score, term) => score + normalize(term).length, 0),
  })).filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ item }) => item);
  const selectedApp = (matchedApp.length ? matchedApp : appGuides.filter(item =>
    ['primeiros_passos', 'nayla'].includes(item.id))).slice(0, 3);
  return {
    registeredAreas: registered.map(item => item.label),
    specialtyGuides: chosen.map(({ terms: _terms, ...guide }) => ({
      ...guide, registered: selectedSpecialties.includes(guide.area),
    })),
    appGuides: selectedApp.map(({ terms: _terms, ...guide }) => guide),
    boundaries: [
      'Os guias por área tratam da operação comercial e da experiência da cliente; não são protocolos clínicos, treinamentos técnicos ou garantias de resultado.',
      'Fatos sobre clientes, agenda, faturamento, disponibilidade, preços cadastrados e ações realizadas devem vir exclusivamente de dados atuais do negócio autenticado.',
      'Uma orientação sobre área não cadastrada deve ser identificada como geral. Para dúvidas médicas, lesões, reações ou contraindicações, oriente a consultar profissional habilitado.',
    ],
  };
}

export function assistantKnowledgeCoverage(): { specialties: Specialty[]; appTopics: string[] } {
  return { specialties: specialtyGuides.map(item => item.area), appTopics: appGuides.map(item => item.id) };
}

// Fail fast if the app adds a specialty without giving Nayla an area guide.
if (specialtyValues.some(value => !specialtyGuides.some(item => item.area === value))) {
  throw new Error('Nayla precisa de orientações para todas as áreas do catálogo.');
}
