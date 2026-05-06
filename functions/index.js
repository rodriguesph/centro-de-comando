/**
 * VETOR — Cloud Functions
 * Direção. Magnitude. Resultado.
 *
 * Canais de notificação:
 *   - E-mail via Gmail SMTP (nodemailer)
 *   - WhatsApp via Cloud API da Meta (graph.facebook.com)
 *
 * Camada de IA via Claude (Anthropic).
 *
 * Segredos (Secret Manager):
 *   ANTHROPIC_API_KEY   — chave do Claude
 *   GMAIL_USER          — endereço Gmail do remetente (ex: paulo@gmail.com)
 *   GMAIL_APP_PASSWORD  — App Password de 16 caracteres (NÃO a senha normal)
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
const nodemailer = require('nodemailer');

admin.initializeApp();
const db = admin.firestore();

// Secrets
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const GMAIL_USER = defineSecret('GMAIL_USER');
const GMAIL_APP_PASSWORD = defineSecret('GMAIL_APP_PASSWORD');
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
// CAMADA E-MAIL (Gmail SMTP via Nodemailer)
// ============================================================================
let _mailTransporter = null;
function getMailTransporter() {
  if (_mailTransporter) return _mailTransporter;
  _mailTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: GMAIL_USER.value(),
      pass: GMAIL_APP_PASSWORD.value()
    }
  });
  return _mailTransporter;
}

async function sendEmail(to, subject, htmlOrText) {
  if (!to) return { ok: false, reason: 'sem-email' };
  try {
    const transporter = getMailTransporter();
    const isHtml = /<\w+/.test(htmlOrText);
    const fromEmail = GMAIL_USER.value();
    const payload = {
      from: `"Vetor" <${fromEmail}>`,
      to,
      subject
    };
    if (isHtml) payload.html = htmlOrText;
    else payload.text = htmlOrText;
    const info = await transporter.sendMail(payload);
    return { ok: true, id: info.messageId };
  } catch (e) {
    console.error('[gmail-smtp] exception', e);
    return { ok: false, reason: e.message };
  }
}

// URL pública do site Vetor (Vercel) — usada no botão de CTA dos e-mails.
const VETOR_URL = 'https://centro-de-comando-kappa.vercel.app/';
// Logo hospedado no próprio site (Vercel serve arquivos estáticos da raiz).
const VETOR_LOGO = VETOR_URL + 'logo-vetor.svg';

// Parser leve de Markdown → HTML (para texto da IA dentro de e-mails)
function mdToHtml(md) {
  if (!md) return '';
  const linhas = String(md).split('\n');
  let out = '';
  let i = 0;

  function inline(s) {
    return s
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/`([^`]+)`/g, '<code style="background:#f1f5f9;padding:1px 6px;border-radius:3px;font-size:12px;font-family:monospace">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  }

  while (i < linhas.length) {
    const ln = linhas[i].trim();
    if (!ln) { i++; continue; }
    if (/^---+$/.test(ln)) { out += '<hr style="border:0;border-top:1px solid #e2e8f0;margin:14px 0">'; i++; continue; }
    if (/^#### /.test(ln)) { out += `<h4 style="margin:14px 0 6px;font-size:12px;color:#475569;text-transform:uppercase;letter-spacing:0.5px">${inline(ln.replace(/^#### /, ''))}</h4>`; i++; continue; }
    if (/^### /.test(ln)) { out += `<h3 style="margin:16px 0 8px;font-size:14px;color:#1e3a8a">${inline(ln.replace(/^### /, ''))}</h3>`; i++; continue; }
    if (/^## /.test(ln)) { out += `<h2 style="margin:18px 0 10px;font-size:16px;color:#0f172a;border-bottom:1px solid #e2e8f0;padding-bottom:6px">${inline(ln.replace(/^## /, ''))}</h2>`; i++; continue; }
    if (/^# /.test(ln)) { out += `<h2 style="margin:20px 0 12px;font-size:17px;color:#0f172a">${inline(ln.replace(/^# /, ''))}</h2>`; i++; continue; }
    if (/^[-•] /.test(ln)) {
      out += '<ul style="margin:8px 0;padding-left:22px">';
      while (i < linhas.length && /^[-•] /.test(linhas[i].trim())) {
        out += `<li style="margin-bottom:4px;line-height:1.5">${inline(linhas[i].trim().replace(/^[-•] /, ''))}</li>`;
        i++;
      }
      out += '</ul>';
      continue;
    }
    if (/^\d+\. /.test(ln)) {
      out += '<ol style="margin:8px 0;padding-left:22px">';
      while (i < linhas.length && /^\d+\. /.test(linhas[i].trim())) {
        out += `<li style="margin-bottom:4px;line-height:1.5">${inline(linhas[i].trim().replace(/^\d+\. /, ''))}</li>`;
        i++;
      }
      out += '</ol>';
      continue;
    }
    // Parágrafo
    let para = inline(ln); i++;
    while (i < linhas.length && linhas[i].trim() && !/^(#|---|[-•] |\d+\. )/.test(linhas[i].trim())) {
      para += '<br>' + inline(linhas[i].trim()); i++;
    }
    out += `<p style="margin:0 0 10px;line-height:1.6">${para}</p>`;
  }
  return out;
}

function buildEmailHtml({ saudacao, tipo, mensagem }) {
  const corpo = mdToHtml(mensagem);
  return `<!doctype html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif;color:#0f172a">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 4px 12px rgba(15,23,42,0.08)">
<tr><td style="background:linear-gradient(135deg,#0f172a,#2563eb);padding:24px 28px;color:#fff">
  <table cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td style="vertical-align:middle;padding-right:12px">
        <img src="${VETOR_LOGO}" alt="Vetor" width="32" height="32" style="display:block;border:0">
      </td>
      <td style="vertical-align:middle">
        <div style="font-weight:800;font-size:20px;letter-spacing:3px;line-height:1">VETOR</div>
        <div style="font-size:10px;letter-spacing:2px;opacity:0.85;margin-top:4px">DIREÇÃO. MAGNITUDE. RESULTADO.</div>
      </td>
    </tr>
  </table>
</td></tr>
<tr><td style="padding:28px">
  <p style="margin:0 0 8px;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:2px;font-weight:800">${tipo}</p>
  <h2 style="margin:0 0 18px;font-size:20px;color:#0f172a">${saudacao}</h2>
  <div style="font-size:14px;color:#334155;margin-bottom:24px">${corpo}</div>
  <table cellpadding="0" cellspacing="0" border="0" style="margin:8px 0">
    <tr><td style="background:#0f172a;border-radius:6px">
      <a href="${VETOR_URL}" style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:13px;font-weight:700;letter-spacing:1px;text-decoration:none;text-transform:uppercase">
        Acessar o Vetor &rarr;
      </a>
    </td></tr>
  </table>
  <p style="margin:18px 0 0;font-size:11px;color:#94a3b8">
    Ou copie e cole este link no navegador: <a href="${VETOR_URL}" style="color:#2563eb;text-decoration:none">${VETOR_URL}</a>
  </p>
</td></tr>
<tr><td style="padding:18px 28px;background:#f8fafc;font-size:11px;color:#64748b;border-top:1px solid #e2e8f0">
  Esta é uma mensagem automática do sistema Vetor.
</td></tr>
</table></td></tr></table></body></html>`;
}

// ============================================================================
// E-mail especializado de BRIEFING DIÁRIO — visual rico com KPIs e gráficos
// ============================================================================
function buildBriefingHtml({ saudacao, dataHoje, kpis, saude, mapaCritico, cargaPessoas, textoIA }) {
  const corpo = mdToHtml(textoIA);

  // Card KPI
  function kpi(num, label, cor) {
    return `<td width="25%" style="padding:4px" valign="top">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;border-top:3px solid ${cor}">
        <tr><td style="padding:14px 8px;text-align:center">
          <div style="font-size:26px;font-weight:800;color:#0f172a;line-height:1">${num}</div>
          <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;font-weight:700;margin-top:6px">${label}</div>
        </td></tr>
      </table>
    </td>`;
  }

  // Saúde da operação (barra)
  let saudeColor = '#10b981', saudeTexto = 'Operação saudável';
  if (saude < 70) { saudeColor = '#f59e0b'; saudeTexto = 'Atenção — alguns pontos críticos'; }
  if (saude < 50) { saudeColor = '#dc3545'; saudeTexto = 'Pressão elevada — ação imediata necessária'; }

  // Mapa crítico (top tarefas)
  const mapaHtml = mapaCritico.length === 0
    ? '<p style="margin:0;color:#94a3b8;font-style:italic;text-align:center;padding:14px">Nenhuma tarefa crítica no momento.</p>'
    : mapaCritico.map(m => `
      <tr>
        <td style="padding:10px 8px;border-bottom:1px solid #f1f5f9">
          <div style="font-size:13px;font-weight:700;color:#0f172a">${m.titulo}</div>
          <div style="font-size:11px;color:#64748b;margin-top:2px">${m.projeto} · ${m.responsavel}</div>
        </td>
        <td style="padding:10px 8px;border-bottom:1px solid #f1f5f9;text-align:right;white-space:nowrap">
          <span style="background:${m.atraso > 0 ? '#fee2e2' : '#fef3c7'};color:${m.atraso > 0 ? '#b91c1c' : '#92400e'};font-size:11px;font-weight:800;padding:3px 10px;border-radius:100px">
            ${m.atraso > 0 ? `−${m.atraso}d` : 'hoje'}
          </span>
        </td>
      </tr>
    `).join('');

  // Carga por pessoa (barras horizontais)
  const maxCarga = Math.max(1, ...cargaPessoas.map(p => p.total));
  const cargaHtml = cargaPessoas.length === 0
    ? '<p style="margin:0;color:#94a3b8;font-style:italic;text-align:center;padding:14px">Sem dados.</p>'
    : cargaPessoas.map(p => {
      const percTotal = (p.total / maxCarga) * 100;
      const percCriticas = p.total > 0 ? (p.criticas / p.total) * 100 : 0;
      return `<tr>
        <td style="padding:6px 0;width:130px;font-size:12px;color:#0f172a;font-weight:600">${p.nome}</td>
        <td style="padding:6px 8px">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;border-radius:4px;height:18px">
            <tr><td style="background:${p.criticas > 0 ? '#dc3545' : '#3b82f6'};width:${percTotal}%;border-radius:4px;height:18px"></td><td></td></tr>
          </table>
        </td>
        <td style="padding:6px 0;width:80px;text-align:right;font-size:11px;color:#475569;font-weight:700">${p.total} ${p.criticas > 0 ? `(${p.criticas} críticas)` : 'ativas'}</td>
      </tr>`;
    }).join('');

  return `<!doctype html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif;color:#0f172a">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0">
<tr><td align="center">
<table width="640" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 6px 20px rgba(15,23,42,0.10);max-width:640px">

  <!-- Header -->
  <tr><td style="background:linear-gradient(135deg,#0f172a 0%,#1e3a8a 50%,#2563eb 100%);padding:28px 32px;color:#fff">
    <table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
      <td style="vertical-align:middle;padding-right:14px;width:44px">
        <img src="${VETOR_LOGO}" alt="Vetor" width="36" height="36" style="display:block;border:0">
      </td>
      <td style="vertical-align:middle">
        <div style="font-weight:800;font-size:22px;letter-spacing:3px;line-height:1">VETOR</div>
        <div style="font-size:10px;letter-spacing:2px;opacity:0.85;margin-top:3px">DIREÇÃO · MAGNITUDE · RESULTADO</div>
      </td>
      <td style="vertical-align:middle;text-align:right">
        <div style="font-size:10px;letter-spacing:1.5px;opacity:0.85;text-transform:uppercase;font-weight:700">Briefing Diário</div>
        <div style="font-size:13px;font-weight:700;margin-top:3px">${dataHoje}</div>
      </td>
    </tr></table>
  </td></tr>

  <!-- Saudação -->
  <tr><td style="padding:28px 32px 8px">
    <h1 style="margin:0;font-size:22px;color:#0f172a">${saudacao}</h1>
  </td></tr>

  <!-- KPIs -->
  <tr><td style="padding:14px 28px">
    <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1.5px;font-weight:800;margin-bottom:10px;padding-left:4px">Estado da Operação</div>
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      ${kpi(kpis.total, 'Demandas', '#0f172a')}
      ${kpi(kpis.criticas, 'Críticas', '#dc3545')}
      ${kpi(kpis.atrasadas, 'Atrasadas', '#f59e0b')}
      ${kpi(kpis.execucao, 'Em execução', '#3b82f6')}
    </tr></table>
  </td></tr>

  <!-- Saúde -->
  <tr><td style="padding:14px 32px">
    <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1.5px;font-weight:800;margin-bottom:8px">Saúde da Operação</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;border-radius:6px;height:14px;overflow:hidden">
      <tr><td style="background:${saudeColor};width:${saude}%;height:14px"></td><td></td></tr>
    </table>
    <div style="margin-top:8px;font-size:12px;color:${saudeColor};font-weight:700">${saude}% — ${saudeTexto}</div>
  </td></tr>

  <!-- Mapa Crítico -->
  <tr><td style="padding:18px 32px 6px">
    <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1.5px;font-weight:800;margin-bottom:10px">Mapa Crítico — Top 5 urgentes</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
      ${mapaHtml}
    </table>
  </td></tr>

  <!-- Carga por Pessoa -->
  <tr><td style="padding:18px 32px 6px">
    <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1.5px;font-weight:800;margin-bottom:10px">Carga por Pessoa — Top 5</div>
    <table width="100%" cellpadding="0" cellspacing="0">
      ${cargaHtml}
    </table>
  </td></tr>

  <!-- Diagnóstico IA -->
  <tr><td style="padding:24px 32px 6px">
    <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1.5px;font-weight:800;margin-bottom:10px">Diagnóstico Vetor IA</div>
    <div style="background:#f8fafc;border-left:3px solid #8b5cf6;padding:18px 20px;border-radius:0 6px 6px 0;font-size:13px;color:#334155">
      ${corpo}
    </div>
  </td></tr>

  <!-- CTA -->
  <tr><td style="padding:24px 32px 28px;text-align:center">
    <table cellpadding="0" cellspacing="0" border="0" align="center"><tr>
      <td style="background:#0f172a;border-radius:6px">
        <a href="${VETOR_URL}" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:13px;font-weight:700;letter-spacing:1px;text-decoration:none;text-transform:uppercase">Acessar o Vetor →</a>
      </td>
    </tr></table>
    <p style="margin:14px 0 0;font-size:11px;color:#94a3b8">
      <a href="${VETOR_URL}" style="color:#2563eb;text-decoration:none">${VETOR_URL}</a>
    </p>
  </td></tr>

  <!-- Footer -->
  <tr><td style="padding:18px 32px;background:#f8fafc;font-size:11px;color:#64748b;border-top:1px solid #e2e8f0;text-align:center">
    Briefing automático gerado pela Vetor IA · ${dataHoje}
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
    secrets: [ANTHROPIC_API_KEY, GMAIL_USER, GMAIL_APP_PASSWORD, WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_TEMPLATE]
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
    secrets: [GMAIL_USER, GMAIL_APP_PASSWORD, WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_TEMPLATE]
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
// 6.a) autoArchiveTasks — agendado: arquiva tarefas concluídas há +30 dias
// ============================================================================
const AUTO_ARCHIVE_DAYS = 30;
exports.autoArchiveTasks = onSchedule(
  {
    schedule: '0 3 * * *', // 03:00 todo dia
    timeZone: 'America/Sao_Paulo',
    region: REGION
  },
  async () => {
    const cutoffMs = Date.now() - (AUTO_ARCHIVE_DAYS * 86400000);
    const cutoffDate = new Date(cutoffMs).toISOString().slice(0, 10); // YYYY-MM-DD

    // Busca tarefas concluídas, ainda não arquivadas, com data_fim antes do cutoff
    const snap = await db.collection('tarefas')
      .where('status', '==', 'concluido')
      .where('data_fim', '<=', cutoffDate)
      .get();

    let arquivadas = 0;
    const batch = db.batch();
    snap.docs.forEach(d => {
      const t = d.data();
      if (t.arquivada) return;
      batch.update(d.ref, {
        arquivada: true,
        arquivada_em: admin.firestore.FieldValue.serverTimestamp(),
        arquivada_por: 'AUTO'
      });
      arquivadas++;
    });
    if (arquivadas > 0) await batch.commit();
    console.log(`[autoArchiveTasks] ${arquivadas} tarefa(s) arquivadas (cutoff ${cutoffDate}).`);
  }
);

// ============================================================================
// 7) dailyBriefing — job agendado diário (7h Brasília)
// ============================================================================
// Calcula KPIs, saúde, mapa crítico e carga por pessoa para um conjunto de tarefas.
function computarDadosBriefing(tarefas) {
  const kpis = {
    total: tarefas.length,
    criticas: tarefas.filter(t => calcStatus(t) === 'critica').length,
    atrasadas: tarefas.filter(t => calcStatus(t) === 'atrasada').length,
    execucao: tarefas.filter(t => calcStatus(t) === 'execucao').length,
    aguardando: tarefas.filter(t => calcStatus(t) === 'aguardando').length,
    concluidas: tarefas.filter(t => calcStatus(t) === 'concluida').length
  };
  const ativas = kpis.total - kpis.concluidas;
  const peso = ativas > 0 ? ((kpis.criticas * 2.5 + kpis.atrasadas * 1.2) / ativas) : 0;
  const saude = Math.max(0, Math.min(100, Math.round(100 - (peso * 80))));

  const hojeMs = Date.now();
  const mapaCritico = tarefas
    .filter(t => calcStatus(t) === 'critica' || calcStatus(t) === 'atrasada')
    .map(t => {
      const fim = t.data_fim ? new Date(t.data_fim + 'T00:00:00').getTime() : hojeMs;
      const atraso = Math.floor((hojeMs - fim) / 86400000);
      return {
        titulo: t.text,
        projeto: t.project || 'Sem projeto',
        responsavel: (t.resps?.[0]?.nome) || 'Sem responsável',
        atraso
      };
    })
    .sort((a, b) => b.atraso - a.atraso)
    .slice(0, 5);

  const cargaMap = {};
  tarefas.forEach(t => {
    const cs = calcStatus(t);
    if (cs === 'concluida') return;
    (t.resps || []).forEach(r => {
      if (!cargaMap[r.email]) cargaMap[r.email] = { nome: r.nome.split(' ').slice(0, 2).join(' '), total: 0, criticas: 0 };
      cargaMap[r.email].total++;
      if (cs === 'critica') cargaMap[r.email].criticas++;
    });
  });
  const cargaPessoas = Object.values(cargaMap).sort((a, b) => (b.criticas - a.criticas) || (b.total - a.total)).slice(0, 5);

  // Paradas há +5 dias
  const cincoDias = 5 * 86400000;
  const paradas = tarefas.filter(t => {
    if (calcStatus(t) === 'concluida') return false;
    if (!t.historico || t.historico.length === 0) return false;
    const ult = t.historico[t.historico.length - 1];
    const m = (ult.data || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (!m) return false;
    const d = new Date(`${m[3]}-${m[2]}-${m[1]}`);
    return (hojeMs - d.getTime()) > cincoDias;
  }).slice(0, 10);

  return { kpis, saude, mapaCritico, cargaPessoas, paradas, totalTarefas: tarefas.length };
}

// Gera o diagnóstico em texto via Claude para um briefing
async function gerarDiagnosticoIA(dados, escopoLabel) {
  const tarefasCriticas = dados.mapaCritico.slice(0, 10);
  const sys = `Você é o Vetor IA, redigindo o DIAGNÓSTICO do briefing diário (escopo: ${escopoLabel}).
NÃO repita números/KPIs (eles já aparecem em cards visuais antes do seu texto).
Seu papel: interpretar o que está acontecendo no escopo "${escopoLabel}", identificar 2-3 padrões críticos
e recomendar 1 ação concreta para o gestor agir HOJE. Máximo 12 linhas.

FORMATO obrigatório (Markdown):
## Padrões observados
- (1-3 bullets curtos com nomes próprios e dados específicos)

## Recomendação para hoje
(1 parágrafo curto e direto, com a ação mais importante)

NÃO repita "X tarefas críticas" — o leitor já viu nos cards. Foque em INTERPRETAÇÃO e DIREÇÃO.`;

  const usr = `ESCOPO: ${escopoLabel}
KPIs: ${JSON.stringify(dados.kpis)}, Saúde: ${dados.saude}%
TAREFAS CRÍTICAS: ${JSON.stringify(tarefasCriticas)}
PARADAS +5 DIAS: ${JSON.stringify(dados.paradas.map(t => ({ titulo: t.text, projeto: t.project, ultimo_reporte: t.historico?.[t.historico.length - 1]?.data, resp: t.resps?.[0]?.nome })))}
CARGA TOP: ${JSON.stringify(dados.cargaPessoas)}

Produza apenas o diagnóstico textual.`;

  return await callClaude(sys, usr);
}

exports.dailyBriefing = onSchedule(
  {
    schedule: '0 7 * * *',
    timeZone: 'America/Sao_Paulo',
    region: REGION,
    secrets: [ANTHROPIC_API_KEY, GMAIL_USER, GMAIL_APP_PASSWORD, WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_TEMPLATE]
  },
  async () => {
    const tasksSnap = await db.collection('tarefas').get();
    const todasTarefas = tasksSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(t => !t.arquivada);
    const usersSnap = await db.collection('usuarios').get();
    const usuarios = usersSnap.docs.map(d => d.data());
    const areasSnap = await db.collection('areas_estrategicas').get();
    const areas = areasSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    const dt = new Date();
    const dataHoje = dt.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', timeZone: 'America/Sao_Paulo' });

    const transporter = getMailTransporter();
    const fromEmail = GMAIL_USER.value();

    let totalEnviados = 0;

    // ============================================================
    // 1) BRIEFING INSTITUCIONAL — para super-admins (todas as tarefas)
    // ============================================================
    const superAdmins = usuarios.filter(u => u.papel === 'super-admin');
    const superAdminEmails = new Set(superAdmins.map(u => u.email));

    if (superAdmins.length > 0) {
      const dados = computarDadosBriefing(todasTarefas);
      const textoIA = await gerarDiagnosticoIA(dados, 'institucional (toda a operação)');

      for (const u of superAdmins) {
        const saudacao = `Bom dia, ${(u.nome || '').split(' ')[0]}.`;
        const html = buildBriefingHtml({
          saudacao, dataHoje,
          escopo: 'Visão Institucional',
          kpis: dados.kpis, saude: dados.saude,
          mapaCritico: dados.mapaCritico, cargaPessoas: dados.cargaPessoas,
          textoIA
        });
        try {
          await transporter.sendMail({
            from: `"Vetor" <${fromEmail}>`,
            to: u.email,
            subject: `[Vetor] Briefing Institucional — ${dataHoje}`,
            html
          });
          totalEnviados++;
        } catch (err) { console.error('briefing institucional email:', err); }

        if (u.telefone) {
          const resumoWa = `Saúde da operação: ${dados.saude}%. ${dados.kpis.criticas} crítica(s), ${dados.kpis.atrasadas} atrasada(s). Briefing completo no e-mail.`;
          try {
            await sendWhatsApp(u.telefone, [(u.nome || '').split(' ')[0] || 'Olá', 'BRIEFING INSTITUCIONAL', resumoWa]);
          } catch (err) { console.error('briefing institucional whatsapp:', err); }
        }
      }

      await db.collection('briefings_diarios').add({
        data: admin.firestore.FieldValue.serverTimestamp(),
        tipo: 'institucional', escopo: 'Visão Institucional',
        kpis: dados.kpis, saude: dados.saude,
        mapaCritico: dados.mapaCritico, cargaPessoas: dados.cargaPessoas,
        paradas: dados.paradas.length, textoIA,
        destinatarios: superAdmins.length
      });
    }

    // ============================================================
    // 2) BRIEFING POR ÁREA — para gestores de área (que NÃO são super-admin)
    //    Cada área gera UM briefing focado, enviado a cada gestor da área.
    // ============================================================
    for (const area of areas) {
      const gestoresEmails = (area.gestores || []).filter(em => !superAdminEmails.has(em));
      if (gestoresEmails.length === 0) continue;

      const tarefasArea = todasTarefas.filter(t => t.area === area.id);
      // Se a área não tem tarefa nenhuma, pular
      if (tarefasArea.length === 0) continue;

      const dados = computarDadosBriefing(tarefasArea);
      const textoIA = await gerarDiagnosticoIA(dados, `área "${area.id}"`);

      for (const gestorEmail of gestoresEmails) {
        const u = usuarios.find(x => x.email === gestorEmail);
        if (!u) continue;
        const saudacao = `Bom dia, ${(u.nome || '').split(' ')[0]}.`;
        const html = buildBriefingHtml({
          saudacao, dataHoje,
          escopo: `Área: ${area.id}`,
          kpis: dados.kpis, saude: dados.saude,
          mapaCritico: dados.mapaCritico, cargaPessoas: dados.cargaPessoas,
          textoIA
        });
        try {
          await transporter.sendMail({
            from: `"Vetor" <${fromEmail}>`,
            to: u.email,
            subject: `[Vetor] Briefing — ${area.id} — ${dataHoje}`,
            html
          });
          totalEnviados++;
        } catch (err) { console.error(`briefing área ${area.id} email:`, err); }

        if (u.telefone) {
          const resumoWa = `Área "${area.id}": ${dados.saude}% de saúde. ${dados.kpis.criticas} crítica(s) e ${dados.kpis.atrasadas} atrasada(s) sob sua gestão.`;
          try {
            await sendWhatsApp(u.telefone, [(u.nome || '').split(' ')[0] || 'Olá', `BRIEFING ${area.id.toUpperCase().slice(0, 30)}`, resumoWa]);
          } catch (err) { console.error(`briefing área ${area.id} whatsapp:`, err); }
        }
      }

      await db.collection('briefings_diarios').add({
        data: admin.firestore.FieldValue.serverTimestamp(),
        tipo: 'area', escopo: `Área: ${area.id}`, areaId: area.id,
        kpis: dados.kpis, saude: dados.saude,
        mapaCritico: dados.mapaCritico, cargaPessoas: dados.cargaPessoas,
        paradas: dados.paradas.length, textoIA,
        destinatarios: gestoresEmails.length
      });
    }

    console.log(`Briefings enviados: ${totalEnviados} e-mails (institucional + por área).`);
  }
);
