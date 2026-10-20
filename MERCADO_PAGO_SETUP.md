# Conectar a conta Mercado Pago à Nayla

Este guia é para **sua conta recebedora dos planos da Nayla**. As profissionais pagam os planos nessa conta; elas não precisam conectar uma conta Mercado Pago própria. O repasse ao seu banco é configurado no painel do Mercado Pago, sem número de conta no código.

## O que a Nayla cobra

| Forma | Plano mensal | Plano anual |
| --- | --- | --- |
| Cartão | R$ 49,90 automaticamente a cada mês, até cancelar | Até 12 cobranças mensais automáticas de R$ 35; R$ 420 se completar as 12 |
| Pix | R$ 49,90 em uma compra; um mês de acesso | R$ 420 em uma compra; um ano de acesso |

**O cartão anual não é uma compra de R$ 420 parcelada na fatura.** São até 12 cobranças automáticas separadas. A profissional pode cancelar as próximas; nesse caso, conserva o acesso até o fim do período pago. Cada cobrança aprovada libera o mês correspondente à fatura. O Pix não tem renovação automática. A Nayla oferece primeiro **30 dias grátis sem cartão**; o backend bloqueia checkout durante esse prazo. Ao fim, a profissional escolhe e autoriza a cobrança no Mercado Pago. A Nayla não recebe número do cartão nem CVV.

## 1. Publique o backend antes de ligar os pagamentos

Use uma API HTTPS pública, `APP_ORIGIN` com o domínio público da Nayla, e banco persistente. O webhook e o retorno do pagamento não funcionam em `localhost`. Leia [SECURITY.md](SECURITY.md) e valide o fluxo completo com contas de teste antes de aceitar dados e pagamentos reais.

## 2. Crie a aplicação na sua conta

1. Acesse [Mercado Pago Developers → Suas integrações](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/create-application) com a conta que receberá as cobranças.
2. Crie uma aplicação que tenha acesso à [API de Assinaturas](https://www.mercadopago.com.br/developers/pt/docs/subscriptions/overview) e à API de pagamentos Pix. Se o produto Assinaturas não estiver disponível na conta, verifique sua habilitação com o suporte Mercado Pago antes de anunciar planos no cartão.
3. Ative as [credenciais de teste](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/resources/credentials). O backend usa o **Access Token**; a Public Key não substitui essa credencial.
4. Mais tarde, ative credenciais de produção na mesma aplicação. Um link de pagamento manual não é o Access Token e não associa o pagamento ao cadastro da profissional.

Guarde o Access Token somente nas variáveis protegidas do backend. Não o envie no chat, não use prefixo `VITE_` e não coloque no Git.

## 3. Configure os avisos de pagamento e assinatura

O endpoint receptor da Nayla é:

```text
https://SEU-DOMINIO/api/billing/webhooks/mercado-pago
```

Ele valida a assinatura HMAC do aviso e consulta o objeto diretamente na API do Mercado Pago. Aceita os tópicos `payment`, `subscription_preapproval` e `subscription_authorized_payment`. Um aviso de assinatura **autorizada** não ativa o acesso; a Nayla exige fatura e pagamento aprovados. O app também consulta as faturas autenticadas na API quando a profissional verifica o estado da assinatura, para conciliar eventos atrasados.

Se a criação de uma assinatura falhar antes do envio ao Mercado Pago ou a API rejeitar a solicitação de forma definitiva, a profissional pode tentar novamente. Se o envio tiver resultado incerto, a Nayla procura a assinatura pelo identificador interno antes de reutilizar o checkout. Quando a API não consegue confirmar a situação, novas cobranças ficam bloqueadas até a verificação pelo suporte; assim, uma segunda assinatura não é criada às cegas.

A [documentação de Webhooks de Assinaturas](https://www.mercadopago.com.br/developers/pt/docs/subscriptions/additional-content/your-integrations/notifications/webhooks) lista esses tópicos, mas também diz que a configuração por **Suas integrações** não se aplica a Assinaturas. A [referência de criação de assinatura](https://www.mercadopago.com.br/developers/pt/reference/online-payments/subscriptions/create-preapproval/post) não documenta `notification_url` no `/preapproval`. Por isso, **a entrega real e a assinatura desses eventos ainda precisam ser confirmadas na sua aplicação Mercado Pago**. Configure o evento `payment` para o Pix, consulte o painel/suporte sobre os eventos de Assinaturas e faça uma compra real controlada após publicar a API. Não considere um teste de tela suficiente para liberar cobrança em produção.

Quando a aplicação gerar uma assinatura secreta para os Webhooks, coloque o valor em `MERCADO_PAGO_WEBHOOK_SECRET` somente no servidor.

## 4. Defina as variáveis do backend

```text
NODE_ENV=production
APP_ORIGIN=https://SEU-DOMINIO
MERCADO_PAGO_ACCESS_TOKEN=<Access Token de produção no cofre do servidor>
MERCADO_PAGO_WEBHOOK_SECRET=<assinatura secreta no cofre do servidor>
```

Nunca configure dados bancários na Nayla. A conta recebedora é a conta à qual pertence o Access Token; você gerencia saldo e transferência no Mercado Pago.

Na primeira assinatura de cada tipo, o backend cria um [plano de assinatura pela API](https://www.mercadopago.com.br/developers/pt/reference/online-payments/subscriptions/create-preapproval-plan/post). O mensal tem frequência mensal e valor R$ 49,90. O anual usa frequência mensal, `repetitions: 12` e valor R$ 35. Ambos restringem o checkout a cartão de crédito. IDs desses planos ficam no banco persistente e são revalidados antes de novos cadastros. Não configure um teste grátis adicional no Mercado Pago: os 30 dias grátis já são controlados pela Nayla.

## 5. Faça os testes

1. Teste cadastro, início e término dos 30 dias grátis. Nenhum checkout deve abrir enquanto o teste estiver ativo.
2. Com credenciais e contas de teste, teste assinatura mensal e anual no cartão, Pix mensal e anual, pagamento recusado e cancelamento. O anual deve cobrar **R$ 35 por mês**, até 12 vezes; cada pagamento libera só um mês.
3. Confira que retorno do checkout e status `authorized` não concedem acesso sem pagamento aprovado. Repita o mesmo webhook e confirme que não amplia o prazo novamente. Teste também um aviso com assinatura inválida.
4. Confirme na sua conta o recebimento real dos Webhooks de Assinaturas e o formato assinado deles. A [documentação de Webhooks do Checkout Pro](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/payment-notifications) informa que pagamentos com credenciais de teste podem não gerar Webhooks reais; use a simulação para testar a URL e depois faça uma compra real controlada, com valor e conta próprios, antes de abrir a cobrança ao público.
5. Verifique o saldo na sua conta Mercado Pago e o repasse ao banco diretamente no painel. Confira taxas e prazos exibidos na sua conta.

## Uso no iPhone e Android

A versão web, inclusive no navegador do celular, abre a autorização de assinatura no Mercado Pago. Os pacotes nativos Android e iOS mostram estado e cancelamento, mas não oferecem checkout no app; as regras das lojas para pagamento de recursos digitais devem ser revistas antes de publicá-los. Veja [README.md](README.md).

Para continuar a integração, informe apenas se a aplicação foi criada, se a API HTTPS está publicada e se o painel confirma os eventos de Assinaturas. **Não envie Access Token, assinatura secreta, dados bancários, número de cartão nem CVV no chat.**
