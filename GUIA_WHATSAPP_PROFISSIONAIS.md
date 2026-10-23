# Guia da profissional: WhatsApp na Nayla

Este guia também aparece dentro do app em **Configurações → Conecte seu WhatsApp e programe os avisos**. Cada profissional usa a **própria conta WhatsApp Business Platform** e o próprio número conectado à API da Meta. Preencher um número no perfil da Nayla não ativa mensagens automáticas.

## O que a Nayla envia

| Situação | Destinatário | Canal no app | WhatsApp automático |
| --- | --- | --- | --- |
| Novo agendamento | Profissional | Sino **Avisos** | Não há WhatsApp para a profissional nesta versão. |
| Confirmação da reserva | Cliente | Tela do agendamento | Modelo **confirmação**, se houver consentimento e conexão. |
| Cliente altera ou cancela | Profissional | Sino **Avisos** e agenda atualizada | Modelo **urgente** para o número da própria cliente. |
| Profissional altera, cancela ou pede remarcação | Cliente | Avisos da cliente e agenda atualizada | Modelo **urgente** para a cliente. |
| 24 horas antes, no dia e 1 hora antes | Cliente | Avisos da cliente | Modelo **lembrete**, se o prazo ainda for aplicável. |

A marca **Responder urgente** fica destacada em **Configurações → Mensagens dos agendamentos**. A mensagem pode começar com `RESPONDER URGENTE`, mas a Cloud API **não aplica uma etiqueta nativa** à conversa do WhatsApp. A Nayla acompanha status de envio; **não recebe o texto das respostas nem oferece uma caixa de conversa para responder dentro do app**. Nos registros urgentes, o botão **Abrir conversa no WhatsApp** abre o WhatsApp instalado sem preparar um segundo envio automático. **Confirme qual número fará a resposta**: se o número conectado à Cloud API não estiver disponível no WhatsApp do aparelho, use uma caixa de atendimento ligada à conta Meta desse número.

## Antes de começar

1. O operador da Nayla precisa hospedar a API com endereço público **HTTPS**, banco persistente e `APP_ORIGIN` correto. Para salvar tokens de cada profissional, deve configurar `WHATSAPP_ENCRYPTION_KEY` com 32 bytes aleatórios em base64 **somente no servidor**. Se essa chave for perdida ou trocada, as credenciais já salvas não poderão mais ser lidas. Ela já pode estar ativa no ambiente local, mas deve ser configurada separadamente na hospedagem.
2. A profissional precisa de acesso à [WhatsApp Business Platform na Meta](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started), a uma conta empresarial Meta, a um aplicativo empresarial e a um número registrado para a Cloud API. A Meta pode exigir etapas de verificação e elegibilidade. Não presuma que o mesmo número usado hoje no app WhatsApp Business possa coexistir com a API sem uma opção de migração ou coexistência oferecida pela Meta.
3. A cliente deve informar seu telefone e marcar que aceita os avisos por WhatsApp. A Nayla exige a autorização no cadastro da cliente **e** no agendamento. Ela pode retirar a preferência em seu portal. Respeite também qualquer pedido de interrupção feito fora do app, como exige a [política do WhatsApp Business](https://whatsappbusiness.com/policy/).

## 1. Prepare a conta e o número na Meta

1. Entre em [Meta for Developers](https://developers.facebook.com/apps/), crie ou selecione um aplicativo empresarial e adicione **WhatsApp**.
2. Na área de configuração da API, conecte e verifique o número da sua empresa. Copie o **Phone Number ID** desse número. Ele é um identificador numérico; **não é o telefone** com DDI.
3. Para uso contínuo, peça ou crie um token de **usuário do sistema** com acesso ao ativo WhatsApp e permissão para envio. O token temporário da tela de teste expira e não serve como solução permanente. Consulte o [início rápido da Meta](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/), que distingue os dois tipos de token.
4. Em **Configurações do aplicativo → Básico**, copie o **App Secret**. A Nayla o usa para conferir a assinatura dos retornos da Meta.
5. Não envie token nem App Secret por chat, e-mail ou link público. Informe-os apenas no formulário autenticado de **Configurações → Confirmação por WhatsApp** na Nayla.

## 2. Crie e aprove os três modelos

No **WhatsApp Manager → Modelos de mensagem**, crie um modelo de texto para cada finalidade abaixo. Selecione **Português (Brasil) / `pt_BR`** e, para estes avisos transacionais, solicite a categoria **Utilidade**. A Meta decide a classificação e a aprovação; forneça exemplos concretos para cada variável quando solicitado. A [Meta explica o gerenciamento de modelos](https://whatsappbusiness.com/blog/manage-message-templates-whatsapp-business-api/) e exige modelos aprovados para iniciar conversas pela Platform.

Os nomes abaixo são sugestões. Se usar outro nome, copie **exatamente** o nome aprovado no campo correspondente da Nayla. O app envia apenas variáveis de **texto no corpo**, na sequência documentada; não configure variáveis extras de cabeçalho ou botão. A Meta envia o **texto aprovado na conta**, que pode diferir da prévia local exibida na Nayla.

### Modelo 1 — confirmação

- **Nome sugerido:** `confirmacao_agendamento`
- **Disparo:** agendamento criado pela cliente ou pela profissional.
- **Variáveis:** `{{1}}` nome da cliente; `{{2}}` nome do espaço; `{{3}}` serviço; `{{4}}` dia da semana; `{{5}}` data em DD/MM/AAAA; `{{6}}` horário.

```text
Olá, {{1}}! Seu agendamento com {{2}} para {{3}} está confirmado: {{4}}, {{5}}, às {{6}}. Até lá!
```

### Modelo 2 — alteração, cancelamento ou pedido de remarcação

- **Nome sugerido:** `aviso_urgente_agendamento`
- **Disparo:** cliente muda dia, hora ou serviço ou cancela; profissional remarca, cancela ou pede remarcação por imprevisto.
- **Variáveis:** `{{1}}` nome da cliente; `{{2}}` espaço; `{{3}}` resumo da mudança; `{{4}}` até oito horários do mês e link para a agenda pública, quando `APP_ORIGIN` estiver configurado. Sem vagas, a variável informa que será preciso combinar outro mês.

```text
RESPONDER URGENTE
Olá, {{1}}! Atualização do seu agendamento com {{2}}: {{3}}
Disponibilidade: {{4}}
Responda com o motivo da alteração e, se precisar remarcar, o melhor horário para você.
```

A Nayla mostra até **oito** opções na mensagem. O link público, se presente, permite ver a disponibilidade completa. A resposta da cliente chega à conta WhatsApp conectada; ela **não é interpretada ou aplicada automaticamente** à agenda pela Nayla. Para atualizar o horário, use o app.

### Modelo 3 — lembrete

- **Nome sugerido:** `lembrete_agendamento`
- **Disparo:** 24 horas antes, no dia do atendimento e uma hora antes, conforme disponibilidade do prazo.
- **Variáveis:** `{{1}}` cliente; `{{2}}` espaço; `{{3}}` serviço; `{{4}}` dia da semana; `{{5}}` data; `{{6}}` horário; `{{7}}` antecedência: `amanhã`, `hoje` ou `em 1 hora`.

```text
Olá, {{1}}! Lembrete: seu atendimento de {{3}} com {{2}} é {{7}}, {{4}}, {{5}} às {{6}}.
```

O aviso **do dia** é preparado às 07h no fuso de São Paulo, ou duas horas antes quando o atendimento é cedo. Agendamentos criados depois de um prazo não recebem aquele lembrete atrasado. A rotina depende da API em execução; com o app fechado, a caixa interna mantém os avisos, mas esta versão não oferece push remoto do sistema operacional.

## 3. Conecte na Nayla

1. Abra **Configurações → Confirmação por WhatsApp** e selecione **Meta WhatsApp Cloud API**.
2. Informe o telefone com DDI para referência, por exemplo `5511999999999`. A Nayla **não verifica** se esse telefone corresponde ao Phone Number ID. O remetente real é o número registrado na Meta para aquele ID.
3. Cole o **Phone Number ID**, os nomes exatos dos três modelos aprovados, o **Access token** e o **App Secret**.
4. Toque em **Salvar WhatsApp**. Token e App Secret não ficam visíveis depois; deixe os campos vazios para manter os valores já salvos. Se aparecer erro sobre `WHATSAPP_ENCRYPTION_KEY`, o operador deve configurar a chave no servidor antes do cadastro.
5. A indicação “configurado” só informa que os campos necessários estão preenchidos. **Não confirma** token válido, número ativo ou aprovação dos modelos. Faça o teste abaixo.

Cada profissional tem sua configuração separada. Há também os modos **Desativado**, sem envio automático, e **Simulação**, que registra o fluxo sem contactar a Meta.

## 4. Configure o webhook de status

1. Na mesma área da Nayla, copie a **URL de callback** e o **Token de verificação** gerados para seu espaço.
2. Em **Webhooks** do aplicativo Meta, cole esses valores e conclua a verificação. Assine o campo **`messages`** da conta WhatsApp para receber status de mensagem.
3. A URL precisa ser pública e HTTPS; `localhost` não é acessível pela Meta. O App Secret salvo na Nayla valida a assinatura dos eventos. Veja o [guia de webhooks da Meta](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/receivingMessages/).

O webhook desta versão lê os status **enviado, entregue, lido ou falhou**. Ele **não** cria conversas com mensagens recebidas dentro da Nayla.

## 5. Faça um teste completo

1. Marque **Simulação** e faça um agendamento de teste com cliente autorizada. Veja o registro **Simulado** em **Mensagens dos agendamentos**; ninguém recebeu WhatsApp.
2. Depois de aprovar os modelos e preencher credenciais, altere para **Meta** e crie outro agendamento com um telefone de teste válido. Confirme que a cliente autorizou WhatsApp e veja o status no histórico.
3. Verifique o recebimento no telefone. **Aceito** significa que a Meta aceitou a solicitação; **Entregue** ou **Lido** dependem do webhook. **Sem consentimento**, **Sem configuração** e **Falhou** significam que não houve confirmação de entrega.
4. Remarque e cancele um agendamento de teste para verificar o modelo urgente. O sino **Avisos** mostra mudanças feitas pela cliente à profissional; o histórico mostra o envio para a cliente e destaca **Responder urgente**. Abra a conversa para responder pessoalmente.
5. Para lembrar a cliente, faça um agendamento futuro que permita observar os prazos do modelo de lembrete. O agendamento e a disponibilidade da agenda se atualizam no app após as mudanças, independentemente do resultado do WhatsApp.

Se o modo estiver **Desativado** ou **Simulação**, o histórico pode oferecer **Abrir no WhatsApp e enviar**. Isso apenas prepara o texto; a profissional precisa tocar em **Enviar** na conversa. Em avisos urgentes que já foram aceitos pela Meta, **Abrir conversa no WhatsApp** abre a conversa sem preencher novamente a mensagem.

## Custos e limites

A [Meta publica a cobrança da Business Platform](https://whatsappbusiness.com/products/platform-pricing/): o preço pode variar por destino e categoria, e é cobrado conforme a entrega. Verifique a tabela vigente antes de ativar o envio para clientes reais. A Nayla não cobra nem paga essas mensagens por conta da profissional.

A conexão atual é feita por token e configuração da própria profissional, **não** por um botão único de autorização da Meta. Os modelos e o número são geridos na Meta. Não há editor de campanhas ou mensagens livres programadas na Nayla; os três fluxos acima são os automáticos implementados.
