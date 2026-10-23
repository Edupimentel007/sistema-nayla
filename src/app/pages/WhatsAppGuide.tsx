import { useState } from 'react'
import { BookOpen, Check, Copy, ExternalLink } from 'lucide-react'
import { Panel } from '../shared'
import './WhatsAppGuide.css'

type MessageModel = {
  id: string
  name: string
  when: string
  variables: string
  body: string
  note: string
}

const models: MessageModel[] = [
  {
    id: 'confirmation',
    name: '1. Confirmação do agendamento',
    when: 'Enviada ao criar um agendamento, pelo link da cliente ou pela agenda da profissional.',
    variables: '1 cliente · 2 espaço · 3 serviço · 4 dia da semana · 5 data · 6 horário',
    body: 'Olá, {{1}}! Seu agendamento com {{2}} para {{3}} está confirmado: {{4}}, {{5}}, às {{6}}. Até lá!',
    note: 'Sugestão de nome: confirmacao_agendamento. Preencha esse nome no campo “Modelo de confirmação aprovado”.',
  },
  {
    id: 'urgent',
    name: '2. Alteração ou cancelamento — responder urgente',
    when: 'Usada se a cliente mudar dia, hora ou serviço, cancelar, ou se a profissional remarcar, cancelar ou pedir remarcação.',
    variables: '1 cliente · 2 espaço · 3 resumo da mudança · 4 até oito horários disponíveis e link da agenda, quando houver',
    body: 'RESPONDER URGENTE\nOlá, {{1}}! Atualização do seu agendamento com {{2}}: {{3}}\nDisponibilidade: {{4}}\nResponda com o motivo da alteração e, se precisar remarcar, o melhor horário para você.',
    note: 'Sugestão de nome: aviso_urgente_agendamento. As opções vêm do mês do agendamento; o link público mostra todos os horários. A resposta da cliente é acompanhada no WhatsApp conectado.',
  },
  {
    id: 'reminder',
    name: '3. Lembretes do atendimento',
    when: 'O mesmo modelo é usado 24 horas antes, no dia do atendimento e uma hora antes, se cada prazo ainda for aplicável.',
    variables: '1 cliente · 2 espaço · 3 serviço · 4 dia da semana · 5 data · 6 horário · 7 “amanhã”, “hoje” ou “em 1 hora”',
    body: 'Olá, {{1}}! Lembrete: seu atendimento de {{3}} com {{2}} é {{7}}, {{4}}, {{5}} às {{6}}.',
    note: 'Sugestão de nome: lembrete_agendamento. O lembrete do dia é preparado às 07h em São Paulo ou duas horas antes, se o atendimento for cedo.',
  },
]

function TemplateCard({ model }: { model: MessageModel }) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(model.body)
      setCopied(true)
      setCopyError(false)
      window.setTimeout(() => setCopied(false), 2500)
    } catch { setCopyError(true) }
  }
  return <section className="whatsapp-guide-model" aria-labelledby={`whatsapp-model-${model.id}`}>
    <h4 id={`whatsapp-model-${model.id}`}>{model.name}</h4>
    <p><strong>Quando sai:</strong> {model.when}</p>
    <p><strong>Variáveis, nesta ordem:</strong> {model.variables}.</p>
    <div className="whatsapp-guide-example-head"><strong>Texto sugerido para o corpo do modelo</strong><button type="button" className="subtle-link" onClick={() => void copy()}>{copied ? <Check size={15}/> : <Copy size={15}/>} {copied ? 'Copiado' : 'Copiar texto'}</button></div>
    <pre>{model.body}</pre>
    {copyError ? <small role="alert">Não foi possível copiar. Selecione o texto acima manualmente.</small> : null}
    <p>{model.note}</p>
  </section>
}

export function WhatsAppGuide() {
  return <Panel className="whatsapp-guide"><div className="panel-heading"><div><span className="eyebrow">PASSO A PASSO</span><h2>Conecte seu WhatsApp e programe os avisos</h2></div><BookOpen size={21}/></div>
    <p className="whatsapp-guide-intro">Cada profissional conecta a própria conta Meta. Comece pelo modo Simulação nesta página; quando os três modelos estiverem aprovados, mude para Meta WhatsApp Cloud API.</p>
    <div className="whatsapp-guide-accordion">
      <details open><summary><span>01</span><strong>Prepare seu número na Meta</strong></summary><div className="whatsapp-guide-body">
        <ol>
          <li>Tenha uma conta empresarial Meta com acesso ao WhatsApp Business Platform. Crie ou selecione um aplicativo empresarial no <a href="https://developers.facebook.com/apps/" target="_blank" rel="noreferrer">painel Meta Developers <ExternalLink size={13}/></a> e adicione o produto WhatsApp.</li>
          <li>Na configuração da API do WhatsApp, conecte e confirme o número pelo processo da Meta. Confira se ele aparece na conta WhatsApp Business correta. Um número digitado na Nayla, sozinho, não conecta o WhatsApp.</li>
          <li>Copie o <strong>Phone Number ID</strong> do número conectado. Para uso contínuo, gere na Meta um token de usuário do sistema com acesso ao ativo WhatsApp e permissão de envio. O token temporário da tela de testes expira.</li>
          <li>Em <strong>Configurações do aplicativo → Básico</strong>, encontre o <strong>App Secret</strong>. Ele permite à Nayla validar os retornos do webhook. Nunca compartilhe token ou segredo por mensagem.</li>
        </ol>
        <p>Se a Nayla disser que falta <code>WHATSAPP_ENCRYPTION_KEY</code>, peça ao administrador da instalação para configurar essa chave no servidor. Ela protege os segredos salvos de cada profissional.</p>
      </div></details>
      <details><summary><span>02</span><strong>Crie três modelos de mensagem</strong></summary><div className="whatsapp-guide-body">
        <p>No <a href="https://business.facebook.com/wa/manage/home/" target="_blank" rel="noreferrer">WhatsApp Manager <ExternalLink size={13}/></a>, abra <strong>Modelos de mensagem</strong>, crie cada modelo como <strong>Utilidade</strong>, escolha <strong>Português (Brasil) / pt_BR</strong>, cole o corpo correspondente abaixo e envie para análise. Inclua exemplos reais de cada variável se a Meta pedir. A aprovação e a categoria final são decididas pela Meta.</p>
        <p>Use somente variáveis de <strong>texto no corpo</strong>, na ordem indicada. A Nayla envia os valores; a cliente recebe o texto aprovado na Meta, que pode ser diferente da prévia mostrada no histórico.</p>
        <div className="whatsapp-guide-models">{models.map(model => <TemplateCard key={model.id} model={model}/>)}</div>
        <p>Quando cada modelo aparecer como <strong>Aprovado</strong>, copie seu nome exato para o campo correspondente nesta página. Alterar o texto na Meta pode exigir nova análise. A Nayla não cria nem aprova modelos por você.</p>
      </div></details>
      <details><summary><span>03</span><strong>Salve a conexão nesta página</strong></summary><div className="whatsapp-guide-body">
        <ol>
          <li>Escolha <strong>Meta WhatsApp Cloud API</strong> em “Modo de envio”.</li>
          <li>Informe seu número com DDI (por exemplo, 55 + DDD + número) e cole o <strong>Phone Number ID</strong>. O envio usa o ID; a Nayla não verifica se o número de referência corresponde a ele.</li>
          <li>Preencha os nomes exatos dos três modelos aprovados, o <strong>Access token</strong> e o <strong>App secret</strong>. Toque em <strong>Salvar WhatsApp</strong>. Os segredos não aparecem novamente na tela; campos vazios mantêm os valores já salvos.</li>
          <li>Confira o estado da conexão no topo. “Configurado” indica que os campos estão presentes, mas <strong>não valida</strong> o token, o número nem a aprovação dos modelos na Meta. Um agendamento de teste confirma o envio.</li>
        </ol>
      </div></details>
      <details><summary><span>04</span><strong>Ative o retorno de entrega</strong></summary><div className="whatsapp-guide-body">
        <ol>
          <li>Depois que a Nayla tiver um endereço público <strong>HTTPS</strong>, copie a <strong>URL de callback</strong> e o <strong>Token de verificação</strong> mostrados na seção WhatsApp desta página.</li>
          <li>Na configuração de <strong>Webhooks</strong> do seu aplicativo Meta, cole os dois valores, verifique a URL e assine o campo <strong>messages</strong> da conta WhatsApp. A Meta precisa alcançar essa URL; <code>localhost</code> não funciona.</li>
          <li>O histórico da Nayla passa de <strong>Aceito</strong> para <strong>Enviado, Entregue ou Lido</strong> conforme os status retornados pela Meta. A Nayla usa o App Secret para verificar a assinatura do retorno.</li>
        </ol>
        <p>O webhook desta versão acompanha apenas status de saída. <strong>Respostas recebidas não aparecem como conversa na Nayla.</strong> Abra a conversa no WhatsApp da sua conta para responder.</p>
      </div></details>
      <details><summary><span>05</span><strong>Teste e acompanhe os avisos</strong></summary><div className="whatsapp-guide-body">
        <ol>
          <li>Crie um agendamento com um número de teste válido e marque a autorização da cliente para WhatsApp. Sem autorização no cadastro <em>e</em> no agendamento, o histórico mostra “Sem consentimento” e não há envio.</li>
          <li>Confira em <strong>Configurações → Mensagens dos agendamentos</strong>. “Simulado” nunca foi enviado. “Aceito” significa que a Meta recebeu a solicitação; entrega exige confirmação pelo webhook. Erros aparecem no registro.</li>
          <li>Remarque ou cancele o agendamento de teste e confira o aviso <strong>Responder urgente</strong>. No histórico, toque em <strong>Abrir conversa no WhatsApp</strong> para tratar a resposta. Se o envio automático não estiver configurado, “Abrir no WhatsApp” prepara a mensagem para envio manual.</li>
          <li>Abra o sino de <strong>Avisos</strong> no app da profissional para ver novos agendamentos, alterações e cancelamentos. A cliente vê lembretes na própria área de agendamentos.</li>
        </ol>
        <p>O destaque “Responder urgente” é texto e destaque <strong>na Nayla</strong>; a Cloud API não cria uma etiqueta nativa na conversa do WhatsApp. O botão abre o WhatsApp instalado no aparelho: <strong>confirme qual número será o remetente</strong>. Se o número da Cloud API não estiver disponível nesse WhatsApp, responda pela caixa de atendimento ligada à conta Meta. Avisos do dispositivo dependem de permissão e do app aberto. Com o app fechado, não há push remoto nesta versão.</p>
      </div></details>
    </div>
    <p className="whatsapp-guide-footer">A Meta pode cobrar por mensagens entregues conforme país e categoria. <a href="https://whatsappbusiness.com/products/platform-pricing/" target="_blank" rel="noreferrer">Consulte os valores atuais na Meta <ExternalLink size={13}/></a>.</p>
  </Panel>
}
