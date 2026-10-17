type Service = { name: string; category: string; duration_minutes: number; price_cents: number };
export type AssistantBusiness = { name: string; slug: string; specialties: string[]; services: Service[] };

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
