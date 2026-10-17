# Como conectar o Mercado Pago à Nayla

Este guia é para a **conta que recebe as assinaturas da Nayla**. Cada profissional conecta separadamente o próprio WhatsApp; ela não precisa conectar a conta Mercado Pago dela para pagar a Nayla.

## 1. Prepare um endereço público seguro

Publique o site e a API Nayla em um domínio com HTTPS e banco persistente. Anote a origem, por exemplo `https://nayla.seudominio.com`. O checkout e o webhook do Mercado Pago não podem retornar ao `localhost`. Mantenha `APP_ORIGIN` igual a essa origem, sem barra final. Leia também [SECURITY.md](SECURITY.md) antes de usar dados reais.

## 2. Crie a aplicação na sua conta Mercado Pago

1. Entre em [Mercado Pago Developers → Suas integrações](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/create-application) com a conta que vai receber os pagamentos.
2. Clique em **Criar aplicação** e escolha uma integração de pagamentos online com **Checkout Pro**.
3. Na aplicação, abra **Credenciais de teste** e depois **Credenciais de produção**. A chave necessária no servidor é o **Access Token** do ambiente correspondente. A *Public Key* não substitui esse token.
4. Guarde o token em um cofre de segredos ou nas variáveis protegidas da hospedagem. Não o envie no chat, não o ponha em `VITE_` e não o inclua no Git.

Um link de pagamento criado manualmente na conta **não é** o Access Token e não conecta automaticamente o pagamento ao cadastro da profissional.

## 3. Configure o webhook

1. Na mesma aplicação, abra **Notificações / Webhooks** e cadastre o tópico **Pagamentos**.
2. Informe `https://SEU-DOMINIO/api/billing/webhooks/mercado-pago`.
3. Copie a **assinatura secreta** do webhook para o cofre de segredos do servidor. A Nayla confere essa assinatura e consulta cada pagamento diretamente no Mercado Pago antes de liberar o plano. [Instruções oficiais de webhook](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/payment-notifications).

Configure as variáveis no servidor, com os valores reais inseridos **somente no ambiente protegido**:

```text
NODE_ENV=production
APP_ORIGIN=https://SEU-DOMINIO
MERCADO_PAGO_ACCESS_TOKEN=<token no cofre de segredos>
MERCADO_PAGO_WEBHOOK_SECRET=<assinatura no cofre de segredos>
```

Os dados bancários de recebimento são configurados **na sua conta Mercado Pago**, não no código ou no `.env` da Nayla.

## 4. Ative o anual em 12x sem juros

Configure em sua conta Mercado Pago o **parcelamento sem acréscimo pago pelo vendedor** para 12 parcelas. Apenas indicar `installments: 12` na preferência limita o máximo e **não garante** que a cliente veja 12x de R$ 35. Considere a taxa do Mercado Pago antes de ativar a oferta. [Guia oficial de parcelamento](https://www.mercadopago.com.br/blog/checkout-pro-parcelamento-sem-juros).

## 5. Teste antes de cobrar de verdade

Use credenciais e contas de teste. Com o servidor público HTTPS funcionando, crie uma conta profissional fictícia na Nayla, inicie um checkout de cartão e um Pix, teste pagamento aprovado, pendente e recusado, e confirme que só o **aprovado** libera o painel. Teste também repetição do webhook, cancelamento/estorno e ausência de credenciais. Depois troque para credenciais de produção e faça uma compra real de valor controlado para validar o fluxo completo.

## 6. Solicite a validação do cartão sem cobrança para o teste de 30 dias

O teste pedido para a Nayla exige **30 dias gratuitos e um cartão válido no início**, enquanto o anual é **uma compra única de R$ 420 em 12 parcelas na fatura**. O Checkout Pro disponível hoje cobra ao concluir o pagamento; ele não serve para validar o cartão sem cobrar. A solução [Pagamentos Automáticos (Orders API)](https://www.mercadopago.com.br/developers/pt/docs/automatic-payments-orders/overview) documenta [registro de cartão para pagamentos futuros com validação automática](https://www.mercadopago.com.br/developers/pt/docs/automatic-payments-orders/register-future-payment), mas o Mercado Pago exige **autorização da equipe Comercial** para usá-la.

Abra um chamado no suporte/comercial da sua conta Mercado Pago e envie esta descrição (sem nenhum token):

> Estou integrando um SaaS chamado Nayla. Preciso validar e registrar o cartão de crédito da assinante sem cobrança inicial para liberar 30 dias de teste. Ao fim do teste, a assinante poderá concluir uma compra única anual de R$ 420 parcelada em 12x de R$ 35 sem juros no Checkout Pro. Solicito habilitação de Pagamentos Automáticos via Orders API e confirmação de quais credenciais, produtos e webhooks são necessários para o registro de cartão sem pagamento inicial.

Quando o Mercado Pago aprovar esse produto, a Nayla ainda precisará integrar e testar a validação antes de liberar o teste grátis. **A versão atual não inicia o prazo de teste no cadastro**, pois isso permitiria acesso sem o cartão exigido. O checkout dos planos pagos continua separado e só libera acesso após pagamento confirmado.

## O que me informar para a próxima etapa

Informe apenas: (1) se a aplicação foi criada, (2) se o domínio HTTPS está publicado, (3) se o webhook recebeu um evento de teste, (4) se as 12 parcelas sem juros foram ativadas e (5) se o Mercado Pago aprovou o uso de Pagamentos Automáticos. **Não envie Access Token, assinatura secreta, número de cartão, CVV nem dados bancários no chat.**
