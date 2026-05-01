# Vetor

**Direção. Magnitude. Resultado.**

Plataforma estratégica de execução de projetos com inteligência artificial integrada.

---

## Estrutura do projeto

```
.
├── index.html              # SPA principal
├── style.css               # Identidade Vetor
├── script.js               # Lógica do front-end
├── firestore.rules         # Regras de segurança do Firestore
├── firebase.json           # Configuração de deploy do Firebase
├── .firebaserc             # Project ID
├── functions/
│   ├── index.js            # Cloud Functions (IA + Resend + WhatsApp)
│   ├── package.json
│   └── .gitignore
└── README.md               # Este arquivo
```

---

## Pré-requisitos

1. **Node.js 20+** instalado.
2. **Firebase CLI**: `npm install -g firebase-tools`
3. **Login no Firebase**: `firebase login`
4. **Plano Blaze** ativado no projeto (necessário para Cloud Functions com chamadas externas).
5. **Conta Anthropic** com chave de API e créditos: https://console.anthropic.com.
6. **Conta Resend** (envio de e-mail): https://resend.com — free tier de 3.000 e-mails/mês.
7. **App Meta WhatsApp Business** (envio de WhatsApp): https://developers.facebook.com — free tier de 1.000 conversas iniciadas pela empresa por mês.

---

## Passo 1 — Aplicar Security Rules

```bash
firebase deploy --only firestore:rules
```

A partir desse momento, ninguém escreve no Firestore via console do navegador sem credencial. O usuário pode editar apenas o próprio telefone — papel e e-mail só pelo super-admin.

---

## Passo 2 — Configurar Resend (e-mail)

1. Crie a conta em https://resend.com (login com Google ou GitHub serve).
2. **Verifique um domínio** (ex: `seudominio.com.br`) — instruções no painel do Resend, basicamente adicionar registros DNS. Sem domínio próprio, é possível usar `onboarding@resend.dev` para testes, mas com limite estrito.
3. Crie uma **API Key** em "API Keys" → "Create".
4. Defina o remetente que vai aparecer nos e-mails — ex: `Vetor <vetor@seudominio.com.br>`.

---

## Passo 3 — Configurar WhatsApp Cloud API

1. Acesse https://developers.facebook.com → **My Apps** → **Create App** → tipo "Business".
2. No painel do app, adicione o produto **WhatsApp**.
3. Em "WhatsApp → Getting Started":
   - Anote o **Phone Number ID** (ID interno do número de teste fornecido pela Meta).
   - Anote o **Access Token temporário** (24h) — para produção, gere um **Permanent Token** em "System Users" do Business Manager.
4. Em "WhatsApp → Message Templates", crie um template:
   - **Nome**: `vetor_alerta`
   - **Categoria**: `UTILITY`
   - **Idioma**: `Português (BR)`
   - **Body** (corpo da mensagem) — colar exatamente:

```
Olá, {{1}}.

Você tem um(a) {{2}} do Vetor:

{{3}}

— Equipe Vetor (Direção. Magnitude. Resultado.)
```

   - Submeta para aprovação (geralmente sai em algumas horas).
5. Para usar com seu número definitivo (não o de teste da Meta), em "WhatsApp → Phone Numbers" adicione o número, faça verificação por SMS/voz e atualize o `WHATSAPP_PHONE_ID`.

> **Atenção:** o número usado no WhatsApp Business API **não pode estar ativo no app WhatsApp normal** (pessoal ou Business). Ou seja: ou um chip dedicado, ou desconectar o número do app antes de cadastrar na API.

---

## Passo 4 — Configurar segredos das Cloud Functions

Defina cada segredo (uma vez):

```bash
firebase functions:secrets:set ANTHROPIC_API_KEY
firebase functions:secrets:set RESEND_API_KEY
firebase functions:secrets:set RESEND_FROM
firebase functions:secrets:set WHATSAPP_TOKEN
firebase functions:secrets:set WHATSAPP_PHONE_ID
firebase functions:secrets:set WHATSAPP_TEMPLATE
```

| Segredo | Valor | Onde achar |
|--|--|--|
| `ANTHROPIC_API_KEY` | `sk-ant-...` | console.anthropic.com → API Keys |
| `RESEND_API_KEY` | `re_...` | resend.com → API Keys |
| `RESEND_FROM` | `Vetor <vetor@dominio.com.br>` | Você define (com domínio verificado) |
| `WHATSAPP_TOKEN` | Permanent Access Token | Meta Business → System Users |
| `WHATSAPP_PHONE_ID` | ID numérico | Meta App → WhatsApp → Phone Numbers |
| `WHATSAPP_TEMPLATE` | `vetor_alerta` | Nome exato do template aprovado |

---

## Passo 5 — Instalar dependências e fazer deploy das Functions

```bash
cd functions
npm install
cd ..
firebase deploy --only functions
```

Isso publica:

| Função | Tipo | O que faz |
|--|--|--|
| `aiParseDemand` | Callable | Transforma fala em demanda estruturada (cadastro por voz). |
| `aiAnalyseTask` | Callable | Diagnóstico executivo de uma tarefa. |
| `aiAssistant` | Callable | Agente conversacional do drawer Vetor IA. |
| `sendSmartReminder` | Callable | Cobrança personalizada por IA + envio multi-canal. |
| `sendNotification` | Callable | Notificação genérica multi-canal (e-mail + WhatsApp). |
| `dailyBriefing` | Schedule | Briefing diário às 7h (Brasília) para super-admins. |

---

## Passo 6 — Hospedar o site (opcional)

```bash
firebase deploy --only hosting
```

Domínio resultante: `https://centrodecomando-paulo.web.app`.

---

## Como funciona o envio de notificações

Cada notificação tenta os dois canais que estiverem disponíveis para o usuário:

- **E-mail** sempre, via Resend (template HTML com identidade Vetor).
- **WhatsApp** se a pessoa cadastrou telefone no perfil — usa o template `vetor_alerta` aprovado.

Se um canal falhar (ex: WhatsApp não responde), o outro segue funcionando. Os logs das Cloud Functions registram qual canal entregou para cada destinatário.

### Como cada usuário cadastra o WhatsApp

1. Faz login no Vetor.
2. Clica no **próprio nome no canto superior direito**.
3. Insere o WhatsApp em formato internacional (ex: `+5511999999999`).
4. Salva.

A partir desse momento, recebe pelos dois canais. Sem cadastro, recebe só por e-mail.

> **O super-admin pode pré-cadastrar o telefone na hora de credenciar o membro**, mas a pessoa pode atualizar a qualquer momento.

---

## Funcionalidades implementadas

### Frente 1 — Higiene técnica e UX

- **Identidade Vetor** completa (logo, paleta, copy, tagline).
- **Toasts não-bloqueantes** substituem `alert()` e `confirm()`.
- **Aba Hoje** com visão pessoal: "Para fazer agora", "Atrasadas", "Aguardando minha validação".
- **Visão Kanban** com drag-and-drop entre status, respeitando permissões.
- **Busca global** por título, projeto, área, escopo, responsável e histórico.
- **Exportação CSV** dos recortes do BI e Operacional.
- **Prioridade estratégica** (Alta/Média/Baixa) em todas as tarefas.
- **`serverTimestamp`** no campo `criadoEm`.
- **Firestore Security Rules** completas, com auto-edição apenas do próprio telefone.

### Frente 2 — IA e notificações multi-canal

- **Briefing diário automatizado** às 7h (Brasília) via Cloud Function agendada.
- **Cadastro por voz** com Web Speech API + Claude estruturando JSON antes de salvar.
- **Painel Vetor IA** lateral com chat conversacional + quick-actions.
- **Diagnóstico de tarefa** ("Analisar com IA" dentro do modal).
- **Cobranças personalizadas** redigidas por Claude com tom configurável.
- **E-mail via Resend** com template HTML elegante (substitui EmailJS).
- **WhatsApp via Cloud API da Meta** com template oficial.
- **Logs de auditoria** em `ai_logs`.

---

## Modelo de dados (Firestore)

```
usuarios/{id}
  nome, email, telefone (E.164), papel ('super-admin' | 'membro')

areas_estrategicas/{nome}
  gestores: [emails]

tarefas/{id}
  area, project, text (título), descricao,
  data_inicio, data_fim, status, prioridade,
  resps: [{nome, email, papel}],
  criadoEm, criadoPor, historico: [{data, autor, texto}], email

ai_logs/{id}
  userEmail, action, payload, ts

briefings_diarios/{id}
  data, stats, paradas, briefing
```

---

## Operação no dia a dia

### Como dono (super-admin)
1. Cadastrar áreas e gestores em Admin.
2. Cadastrar membros em Equipe (com WhatsApp ou pedir que cada um cadastre depois).
3. Aprovar tarefas em "Aguardando minha validação" na aba Hoje.
4. Receber o briefing às 7h por e-mail e WhatsApp.
5. Usar o Vetor IA para perguntas executivas e ações em lote.

### Como gestor de área/projeto
1. Lançar demandas em Nova Demanda ou pelo botão Voz.
2. Acompanhar pelo BI e Kanban.
3. Pedir análises e cobranças via Vetor IA.

### Como executor
1. Abrir aba Hoje.
2. Trabalhar nas tarefas em "Para fazer agora" e "Atrasadas".
3. Ao terminar, mover no Kanban para "Aguardando OK" ou reportar progresso no modal.
4. **Cadastrar o WhatsApp em "Meu Perfil"** para receber alertas sem checar e-mail.

---

## Próximas evoluções sugeridas

- Subtarefas/checklist dentro de cada demanda.
- Dependências entre tarefas (A bloqueia B).
- Anexos via Firebase Storage.
- Comentários com @menções.
- Relatórios em vídeo (TTS + slides + ffmpeg).
- App mobile (PWA já facilitado pela base atual).
- Botão WhatsApp interativo: receber resposta direto da mensagem (requer webhook).

---

## Suporte

Para qualquer dúvida sobre uso do sistema, abra o painel **Vetor IA** e pergunte. Para evolução de código, fale com o time técnico.
