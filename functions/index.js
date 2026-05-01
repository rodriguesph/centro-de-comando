/**
 * VETOR — Cloud Functions
 * Direção. Magnitude. Resultado.
 *
 * Canais de notificação:
 *   - E-mail via Resend (resend.com)
 *   - WhatsApp via Cloud API da Meta (graph.facebook.com)
 *
 * Camada de IA via Claude (Anthropic).
 *
 * Segredos (Secret Manager):
 *   ANTHROPIC_API_KEY   — chave do Claude
 *   RESEND_API_KEY      — chave do Resend
 *   RESEND_FROM         — remetente verificado (ex: "Vetor <vetor@seu-dominio.com>")
 *   WHATSAPP_TOKEN      — Permanent Access Token do app Meta
 *   WHATSAPP_PHONE_ID   — ID do número WhatsApp Business
 *   WHATSAPP_TEMPLATE   — nome do template aprovado (ex: "vetor_alerta")
 *
 * Definição via CLI:
 *   firebase functions:secrets:set ANTHROPIC_API_KEY
 *   ... (idem para os outros)
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const Anthropic = require('@anthropic-ai/sdk');
const { Resend } = require('resend');

admin.initializeApp();
const db = admin.firestore();

// Secrets
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const RESEND_API_KEY = defineSecret('RESEND_API_KEY');
const RESEND_FROM = defineSecret('RESEND_FROM');
const WHATSAPP_TOKEN = defineSecret('WHATSAPP_TOKEN');
const WHATSAPP_PHONE_ID = defineSecret('WHATSAPP_PHONE_ID');
const WHATSAPP_TEMPLATE = defineSecret('WHATSAPP_TEMPLATE');

const REGION = 'southamerica-east1';
const COMMON_OPTS = { region: REGION, cors: true };

// ============================================================================
// HELPERS COMUNS
// ============================================================================
function requireAuth(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Faça login para usar a Vetor IA.');
  return request.auth.token.email.toLowerCase();
}

async function getUserDoc(email) {
  const q = await db.collection('usuarios').where('email', '==', email).limit(1).get();
  if (q.empty) throw new HttpsError('permission-denied', 'Usuário não credenciado.');
  return q.docs[0].data();
}

async function getUserByEmail(email) {
  const q = await db.collection('usuarios').where('email', '==', email).limit(1).get();
  return q.empty ? null : q.docs[0].data();
}

function calcStatus(t) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = t.data_inicio ? new Date(t.data_inicio + 'T00:00:00') : today;
  const end = t.data_fim ? new Date(t.data_fim + 'T00:00:00') : today;
  if (t.status === 'concluido') return 'concluida';
  if (t.status === 'aprovacao') return 'aguardando';
  if (today > end) return 'critica';
  if (t.status === 'andamento') return 'execucao';
  if (today >= start) return 'atrasada';
  return 'nao_iniciada';
}

// Normaliza telefone para formato Meta (só dígitos, com DDI)
function normalizePhone(phone) {
  if (!phone) return null;
  let digits = String(phone).replace(/\D/g, '');
  if (!digits) return null;
  // Se não tiver DDI, presume Brasil
  if (digits.length === 10 || digits.length === 11) digits = '55' + digits;
  if (digits.length < 12) return null;
  return digits;
}

// ============================================================================
// CAMADA CLAUDE
// ============================================================================
async function callClaude(systemPrompt, userPrompt, opts = {}) {
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
  const res = await client.messages.create({
    model: opts.model || 'claude-sonnet-4-6',
    max_tokens: opts.max_tokens || 1500,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }]
  });
  return res.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
}

async function callClaudeJson(systemPrompt, userPrompt) {
  const raw = await callClaude(systemPrompt + '\n\nResponda APENAS com JSON válido, sem texto fora do JSON, sem code fences.', userPrompt, { max_tokens: 1500 });
  let txt = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  try { return JSON.parse(txt); } catch (e) {
    const match = txt.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new HttpsError('internal', 'Resposta da IA não é JSON válido: ' + raw.slice(0, 200));
  }
}

// ============================================================================
// CAMADA E-MAIL (Resend)
// ============================================================================
async function sendEmail(to, subject, htmlOrText) {
  if (!to) return { ok: false, reason: 'sem-email' };
  try {
    const resend = new Resend(RESEND_API_KEY.value());
    const isHtml = /<\w+/.test(htmlOrText);
    const payload = {
      from: RESEND_FROM.value(),
      to: [to],
      subject
    };
    if (isHtml) payload.html = htmlOrText;
    else payload.text = htmlOrText;
    const { data, error } = await resend.emails.send(payload);
    if (error) { console.error('[resend]', error); return { ok: false, reason: error.message || 'erro' }; }
    return { ok: true, id: data?.id };
  } catch (e) {
    console.error('[resend] exception', e);
    return { ok: false, reason: e.message };
  }
}

function buildEmailHtml({ saudacao, tipo, mensagem }) {
  // Template HTML simples e elegante para os e-mails do Vetor
  return `<!doctype html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif;color:#0f172a">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 4px 12px rgba(15,23,42,0.08)">
<tr><td style="background:linear-gradient(135deg,#0f172a,#2563eb);padding:24px 28px;color:#fff">
  <div style="display:inline-block;width:24px;height:24px;background:#2563eb;clip-path:polygon(10% 90%,90% 50%,10% 10%,30% 50%);vertical-align:middle"></div>
  <span style="font-weight:800;font-size:18px;letter-spacing:3px;margin-left:10px;vertical-align:middle">VETOR</span>
  <div style="font-size:11px;letter-spacing:2px;opacity:0.85;margin-top:4px">DIREÇÃO. MAGNITUDE. RESULTADO.</div>
</td></tr>
<tr><td style="padding:28px">
  <p style="margin:0 0 8px;font-size:13px;color:#64748b;text-transform:uppercase;letter-spacing:1px;font-weight:700">${tipo}</p>
  <h2 style="margin:0 0 14px;font-size:18px">${saudacao}</h2>
  <div style="font-size:14px;line-height:1.55;color:#334155;white-space:pre-wrap">${mensagem}</div>
</td></tr>
<tr><td style="padding:18px 28px;background:#f8fafc;font-size:11px;color:#64748b;border-top:1px solid #e2e8f0">
  Esta é uma mensagem automática do sistema Vetor. Acesse a plataforma para mais detalhes.
</td></tr>
</table></td></tr></table></body></html>`;
}

// ============================================================================
// CAMADA WHATSAPP (Cloud API da Meta)
// ============================================================================
async function sendWhatsApp(toPhone, params) {
  if (!toPhone) return { ok: false, reason: 'sem-telefone' };
  const phone = normalizePhone(toPhone);
  if (!phone) return { ok: false, reason: 'telefone-invalido' };
  try {
    const url = `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_ID.value()}/messages`;
    const body = {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'template',
      template: {
        name: WHATSAPP_TEMPLATE.value(),
        language: { code: 'pt_BR' },
        components: [{
          type: 'body',
          parameters: params.map(p => ({ type: 'text', text: String(p).slice(0, 1024) }))
        }]
      }
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + WHATSAPP_TOKEN.value(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    const json = await res.json();
    if (!res.ok) { console.error('[whatsapp]', json); return { ok: false, reason: json.error?.message || 'erro' }; }
    return { ok: true, id: json.messages?.[0]?.id };
  } catch (e) {
    console.error('[whatsapp] exception', e);
    return { ok: false, reason: e.message };
  }
}

// Envia para um usuário pelos canais disponíveis (e-mail + whatsapp)
async function notifyUser(user, tipo, saudacao, mensagem) {
  const result = { email: null, whatsapp: null };

  // E-mail
  if (user.email) {
    const html = buildEmailHtml({ saudacao, tipo, mensagem });
    result.email = await sendEmail(user.email, `[Vetor] ${tipo}`, html);
  }
  // WhatsApp (template flex de 3 parâmetros: nome, tipo, mensagem)
  if (user.telefone) {
    result.whatsapp = await sendWhatsApp(user.telefone, [
      (user.nome || '').split(' ')[0] || 'Olá',
      tipo,
      mensagem.slice(0, 900) // WhatsApp body parameter limit
    ]);
  }
  return result;
}

// Auditoria
async function logAi(userEmail, action, payload) {
  try {
    await db.collection('ai_logs').add({
      userEmail,
      action,
      payload: JSON.stringify(payload).slice(0, 2000),
      ts: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (e) { console.error('logAi falhou:', e); }
}

// ============================================================================
// 1) aiParseDemand — converte transcrição de voz em demanda estruturada
// ============================================================================
exports.aiParseDemand = onCall(
  { ...COMMON_OPTS, secrets: [ANTHROPIC_API_KEY] },
  async (request) => {
    const userEmail = requireAuth(request);
    await getUserDoc(userEmail);

    const { texto, contexto } = request.data || {};
    if (!texto || typeof texto !== 'string') throw new HttpsError('invalid-argument', 'Texto vazio.');

    const sys = `Você é o Vetor IA, um assistente executivo brasileiro especializado em transformar
fala humana em demandas estruturadas de gestão de projetos. Seu trabalho é interpretar o que o
gestor falou e devolver um JSON estrito com os campos abaixo, escolhendo a área e o projeto
mais adequados a partir do contexto fornecido. Datas em formato ISO (YYYY-MM-DD).
Se o gestor disser "sexta", calcule a próxima sexta a partir da data atual no Brasil.

Formato exigido:
{
  "area": string,
  "projeto": string,
  "titulo": string,
  "escopo": string,
  "data_inicio": "YYYY-MM-DD",
  "data_fim": "YYYY-MM-DD",
  "prioridade": "alta"|"media"|"baixa",
  "responsaveis": [
    { "email": string, "nome": string, "papel": "executor"|"gestor" }
  ]
}

Os e-mails de responsaveis DEVEM existir no contexto.usuarios.`;

    const hoje = new Date().toISOString().slice(0, 10);
    const usr = `DATA DE HOJE: ${hoje}

CONTEXTO:
- Áreas: ${JSON.stringify(contexto.areas)}
- Projetos: ${JSON.stringify(contexto.projetos)}
- Usuários: ${JSON.stringify(contexto.usuarios)}

FALA DO GESTOR:
"""${texto}"""

Estruture a demanda e devolva o JSON.`;

    const json = await callClaudeJson(sys, usr);
    await logAi(userEmail, 'aiParseDemand', { texto, json });
    return json;
  }
);

// ============================================================================
// 2) aiAnalyseTask — diagnóstico executivo de uma tarefa
// ============================================================================
exports.aiAnalyseTask = onCall(
  { ...COMMON_OPTS, secrets: [ANTHROPIC_API_KEY] },
  async (request) => {
    const userEmail = requireAuth(request);
    await getUserDoc(userEmail);

    const { taskId } = request.data || {};
    if (!taskId) throw new HttpsError('invalid-argument', 'taskId obrigatório.');

    const taskSnap = await db.collection('tarefas').doc(taskId).get();
    if (!taskSnap.exists) throw new HttpsError('not-found', 'Tarefa não encontrada.');
    const task = taskSnap.data();

    const relSnap = await db.collection('tarefas').where('project', '==', task.project).limit(20).get();
    const relacionadas = relSnap.docs.map(d => {
      const t = d.data();
      return { titulo: t.text, status: calcStatus(t), prazo: t.data_fim, responsavel: (t.resps?.[0]?.nome) || '-' };
    });

    const sys = `Você é o Vetor IA, consultor executivo. Diagnóstico curto (máx 8 linhas), em português,
no tom de um chief of staff sênior. Estrutura: 1) leitura do quadro, 2) provável raiz do
problema (se houver), 3) três caminhos de ação com prós/contras, 4) recomendação final.`;

    const usr = `TAREFA:
${JSON.stringify({
      area: task.area, projeto: task.project, titulo: task.text,
      escopo: task.descricao, data_inicio: task.data_inicio, data_fim: task.data_fim,
      status: calcStatus(task), prioridade: task.prioridade || 'media',
      responsaveis: (task.resps || []).map(r => ({ nome: r.nome, papel: r.papel })),
      historico: (task.historico || []).slice(-10)
    }, null, 2)}

PROJETO COMPLETO:
${JSON.stringify(relacionadas, null, 2)}`;

    const analise = await callClaude(sys, usr);
    await logAi(userEmail, 'aiAnalyseTask', { taskId });
    return { analise };
  }
);

// ============================================================================
// 3) aiAssistant — agente conversacional com execução de ações
// ============================================================================
exports.aiAssistant = onCall(
  { ...COMMON_OPTS, secrets: [ANTHROPIC_API_KEY] },
  async (request) => {
    const userEmail = requireAuth(request);
    await getUserDoc(userEmail);

    const { messages, contexto } = request.data || {};
    if (!Array.isArray(messages)) throw new HttpsError('invalid-argument', 'messages deve ser array.');

    const sys = `Você é o Vetor IA, assistente executivo do produto Vetor (gestão estratégica).
Português brasileiro, tom direto e elegante.

Contexto JSON:
${JSON.stringify(contexto, null, 2)}

Responda SEMPRE em JSON:
  { "resposta": string, "acoes": [ { "tipo": string, "payload": object } ] }

Tipos de ação válidos:
- "criar_demanda": payload = { area, projeto, titulo, escopo, data_inicio, data_fim,
    prioridade, responsaveis: [{email, papel}] } — apenas se pedido CLARAMENTE.
- "atualizar_status": payload = { taskId, novoStatus } com novoStatus ∈ {fazer,andamento,aprovacao,concluido}.
- "enviar_cobranca": payload = { taskId, tom: "gentil"|"firme"|"escalada" }.

Se faltar info para executar, pergunte na "resposta" e devolva acoes:[].
Em respostas analíticas: cite NÚMEROS e nomes específicos. Use **negrito** para destaques.`;

    const userMsg = messages.map(m => `[${m.role.toUpperCase()}] ${m.content}`).join('\n\n');
    const json = await callClaudeJson(sys, userMsg);
    await logAi(userEmail, 'aiAssistant', { qtd: messages.length });
    return json;
  }
);

// ============================================================================
// 4) sendSmartReminder — cobrança personalizada por IA + envio multi-canal
// ============================================================================
exports.sendSmartReminder = onCall(
  {
    ...COMMON_OPTS,
    secrets: [ANTHROPIC_API_KEY, RESEND_API_KEY, RESEND_FROM, WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_TEMPLATE]
  },
  async (request) => {
    const userEmail = requireAuth(request);
    await getUserDoc(userEmail);

    const { taskId, tom } = request.data || {};
    if (!taskId) throw new HttpsError('invalid-argument', 'taskId obrigatório.');

    const taskSnap = await db.collection('tarefas').doc(taskId).get();
    if (!taskSnap.exists) throw new HttpsError('not-found', 'Tarefa não encontrada.');
    const task = taskSnap.data();

    const sys = `Você redige cobranças curtas em português brasileiro para o sistema Vetor.
Tom: ${tom || 'gentil'}. Seja humano, específico e claro. Sempre:
- Cumprimente pelo primeiro nome.
- Cite título e projeto.
- Indique o prazo (ou que está vencido).
- Peça resposta clara: novo prazo, status, ou bloqueio.
- Encerre cordialmente.

Devolva APENAS o corpo da mensagem (sem assinatura, sem cabeçalho — o template já cuida).`;

    const usr = `TAREFA:
${JSON.stringify({
      projeto: task.project, titulo: task.text, escopo: task.descricao,
      prazo: task.data_fim, status: calcStatus(task),
      historico_recente: (task.historico || []).slice(-5)
    }, null, 2)}

RESPONSÁVEIS: ${JSON.stringify(task.resps || [])}

Redija a cobrança.`;

    const corpo = await callClaude(sys, usr);

    const enviados = { email: [], whatsapp: [] };
    for (const r of task.resps || []) {
      const userFull = await getUserByEmail(r.email);
      if (!userFull) continue;
      const result = await notifyUser(userFull, 'COBRANÇA', `Olá, ${r.nome.split(' ')[0]}.`, corpo);
      if (result.email?.ok) enviados.email.push(r.email);
      if (result.whatsapp?.ok) enviados.whatsapp.push(r.email);
    }

    await taskSnap.ref.update({
      historico: admin.firestore.FieldValue.arrayUnion({
        data: new Date().toLocaleString('pt-BR'),
        autor: 'VETOR IA',
        texto: `Cobrança "${tom || 'gentil'}" enviada — e-mail: ${enviados.email.length}, WhatsApp: ${enviados.whatsapp.length}.`
      })
    });

    await logAi(userEmail, 'sendSmartReminder', { taskId, enviados, tom });
    return { ok: true, enviados, corpo };
  }
);

// ============================================================================
// 5) sendNotification — envio multi-canal genérico (substitui o EmailJS no client)
// ============================================================================
exports.sendNotification = onCall(
  {
    ...COMMON_OPTS,
    secrets: [RESEND_API_KEY, RESEND_FROM, WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_TEMPLATE]
  },
  async (request) => {
    const userEmail = requireAuth(request);
    const { destinatarios, tipo, saudacao, mensagem } = request.data || {};
    if (!Array.isArray(destinatarios) || !mensagem) {
      throw new HttpsError('invalid-argument', 'destinatarios[] e mensagem obrigatórios.');
    }
    const resultados = [];
    for (const email of destinatarios) {
      const u = await getUserByEmail(email);
      if (!u) { resultados.push({ email, ok: false, reason: 'usuario-nao-encontrado' }); continue; }
      const r = await notifyUser(u, tipo || 'NOTIFICAÇÃO', saudacao || `Olá, ${(u.nome || '').split(' ')[0]}.`, mensagem);
      resultados.push({ email, ...r });
    }
    return { ok: true, resultados };
  }
);

// ============================================================================
// 6) dailyBriefing — job agendado diário (7h Brasília)
// ============================================================================
exports.dailyBriefing = onSchedule(
  {
    schedule: '0 7 * * *',
    timeZone: 'America/Sao_Paulo',
    region: REGION,
    secrets: [ANTHROPIC_API_KEY, RESEND_API_KEY, RESEND_FROM, WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_TEMPLATE]
  },
  async () => {
    const tasksSnap = await db.collection('tarefas').get();
    const tarefas = tasksSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const usersSnap = await db.collection('usuarios').get();
    const usuarios = usersSnap.docs.map(d => d.data());

    const stats = {
      total: tarefas.length,
      criticas: tarefas.filter(t => calcStatus(t) === 'critica').length,
      atrasadas: tarefas.filter(t => calcStatus(t) === 'atrasada').length,
      execucao: tarefas.filter(t => calcStatus(t) === 'execucao').length,
      aguardando: tarefas.filter(t => calcStatus(t) === 'aguardando').length
    };

    const cincoDias = 5 * 86400000;
    const agora = Date.now();
    const paradas = tarefas.filter(t => {
      if (calcStatus(t) === 'concluida') return false;
      if (!t.historico || t.historico.length === 0) return false;
      const ult = t.historico[t.historico.length - 1];
      const m = (ult.data || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
      if (!m) return false;
      const d = new Date(`${m[3]}-${m[2]}-${m[1]}`);
      return (agora - d.getTime()) > cincoDias;
    }).slice(0, 10);

    const sys = `Você é o Vetor IA produzindo o BRIEFING DIÁRIO EXECUTIVO. Português, conciso,
máx 14 linhas. Estrutura: 1 frase de quadro geral, 3 pontos de atenção (com nome/projeto/dados),
sugestão de ação. Use **negrito** para destaques.`;
    const usr = `ESTATÍSTICAS: ${JSON.stringify(stats)}
CRÍTICAS (TOP 10): ${JSON.stringify(tarefas.filter(t => calcStatus(t) === 'critica').slice(0, 10).map(t => ({ titulo: t.text, projeto: t.project, prazo: t.data_fim, resp: t.resps?.[0]?.nome })))}
PARADAS +5 DIAS: ${JSON.stringify(paradas.map(t => ({ titulo: t.text, projeto: t.project, ultimo_reporte: t.historico?.[t.historico.length - 1]?.data })))}

Produza o briefing.`;

    const briefing = await callClaude(sys, usr);

    const superAdmins = usuarios.filter(u => u.papel === 'super-admin');
    for (const u of superAdmins) {
      try {
        await notifyUser(u, 'BRIEFING DIÁRIO', `Bom dia, ${(u.nome || '').split(' ')[0]}.`, briefing);
      } catch (err) { console.error('briefing erro:', err); }
    }

    await db.collection('briefings_diarios').add({
      data: admin.firestore.FieldValue.serverTimestamp(),
      stats, paradas: paradas.length, briefing
    });

    console.log('Briefing diário enviado para', superAdmins.length, 'admins.');
  }
);
