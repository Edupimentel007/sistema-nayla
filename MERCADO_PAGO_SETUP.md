# Cobrança manual das profissionais

A Nayla não cobra dentro do app. Você concede pessoalmente os 30 dias iniciais de teste a cada profissional pelo painel do super admin. Após o teste, combina o pagamento diretamente com ela, verifica o recebimento no Mercado Pago e registra a continuidade do acesso no mesmo painel. A profissional não informa cartão, CPF de cobrança ou chave Pix à Nayla.

## Como receber pelo Mercado Pago

1. Entre na **sua** conta Mercado Pago e crie um link de pagamento com o valor e as condições que combinar com a profissional. Confira no próprio Mercado Pago o destinatário, as taxas, as parcelas e a forma de recebimento antes de enviar o link.
2. Envie o link por um canal em que você já se comunica com ela. Não peça número de cartão, CVV, senha bancária nem código de autenticação.
3. Confirme no painel Mercado Pago que o pagamento daquela profissional foi recebido. Guarde sua conciliação financeira fora da Nayla; um comprovante enviado pela pessoa não substitui a verificação na conta recebedora.
4. No super admin, localize o espaço pela conta e pelo contato cadastrado e registre o período de acesso correspondente. Guarde valor, data e referência do pagamento em seu controle financeiro externo. Ao fim do período, renove manualmente após novo recebimento ou suspenda o acesso.

O link comum de pagamento **não atualiza o acesso automaticamente**. A Nayla não lê a sua conta Mercado Pago, não processa cartão nem recebe confirmação de pagamentos nessa modalidade. Nenhum Access Token, Public Key ou segredo de Webhook Mercado Pago é necessário no servidor para cobrar manualmente.

## Teste de 30 dias e controle de acesso

Uma conta recém-criada fica aguardando a decisão do super admin. O prazo de 30 dias começa quando você concede o teste no painel; criar outra sessão ou entrar em outro aparelho não inicia nem renova o prazo. Confira a profissional antes da concessão. A Nayla registra um identificador aleatório da instalação ou do navegador e usa sua impressão HMAC para negar um segundo teste no mesmo ambiente observado. Esse sinal pode ser perdido ao limpar cookies, reinstalar o app ou trocar de aparelho; também pode ser forjado. Ele não identifica o hardware nem substitui sua aprovação manual.

Para criar seu acesso de super admin, cadastre primeiro uma conta profissional sua e, em um terminal interativo no servidor apontado para o banco correto, execute `npm run admin:promote -- seu-email@exemplo.com`. O comando pede a senha atual da conta sem mostrá-la e exige a confirmação `PROMOVER`. A promoção usa a conta existente; confira a identidade antes de promover qualquer outra. Faça login novamente com essa conta e abra `/superadmin` no endereço web da Nayla (localmente, `http://localhost:3001/superadmin`). A API disponibiliza a consulta de contas, concessão, extensão, bloqueio e auditoria sob `/api/admin` somente para a conta promovida.

Teste com contas fictícias: cadastro sem acesso automático; concessão uma única vez; tentativa de novo teste no mesmo navegador/instalação; acesso pelo navegador e pelo app; vencimento; suspensão imediata; nova liberação manual; bloqueio da agenda pública para novos agendamentos enquanto o espaço estiver suspenso. As decisões de acesso precisam sobreviver ao reinício da API, por isso a publicação exige um banco persistente.

## Integração anterior e assinaturas existentes

O repositório possuía um checkout e uma integração de Webhooks Mercado Pago. O fluxo novo deixa essas rotas fora do app e do servidor ativo. **Desativar o código não cancela assinaturas criadas anteriormente no Mercado Pago.** Se houve qualquer cobrança de teste ou produção pela integração antiga, confira no painel Mercado Pago e cancele cada recorrência que não deve continuar. Verifique também reembolsos e pagamentos pendentes diretamente com o provedor. Não apague o histórico de cobrança antes de reconciliar esses casos.

O dinheiro recebido e o acesso concedido agora são processos manuais separados. Se no futuro você quiser confirmação automática, será necessária uma nova integração com API, Webhooks autenticados, conciliação de eventos e testes reais antes de voltar a ativar uma rota de pagamento.

## iPhone, Android e web

As profissionais usam as mesmas funções conforme o acesso concedido. O app não abre checkout nem oferece compra de recursos digitais. Antes de distribuir pacotes nas lojas, reveja as regras atuais de cada loja para a forma de venda e a comunicação sobre pagamentos externos.
