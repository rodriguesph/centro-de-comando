// ==========================================================================
// VETOR — Direção. Magnitude. Resultado.
// Camada de aplicação (frontend).
// ==========================================================================

// ==========================================================================
// ESTADO GLOBAL
// ==========================================================================
let allTasks = [];
let allUsers = [];
let allAreasData = [];
let currentFilteredTasks = [];
let currentTaskId = null;
let currentUserEmail = null;
let currentUserRole = null;
let currentUserNome = null;
let managedAreas = [];
let managedProjects = [];
let biChartProgress = null;
let biChartTeam = null;
let biSelectedUsers = [];
let biSelectedStatuses = [];
let iaConversation = []; // histórico de chat IA (papel/conteúdo)
let vozRecognition = null;
let vozIsRecording = false;
let vozParsedDemand = null; // demanda estruturada pela IA aguardando confirmação

// ==========================================================================
// TOASTS — substituem alert()
// ==========================================================================
function toast(msg, type = 'info', timeout = 3500) {
    const container = document.getElementById('toast-container');
    if (!container) { console.log('[toast]', type, msg); return; }
    const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
    const el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.innerHTML = `<span class="toast-icon">${icons[type] || ''}</span><span>${msg}</span>`;
    container.appendChild(el);
    setTimeout(() => {
        el.classList.add('fade-out');
        setTimeout(() => el.remove(), 250);
    }, timeout);
}

// Confirm dialog não-bloqueante (substitui confirm())
function vetorConfirm(message, title = 'Confirmar') {
    return new Promise((resolve) => {
        document.getElementById('confirm-title').innerText = title;
        document.getElementById('confirm-message').innerText = message;
        const dialog = document.getElementById('confirm-dialog');
        dialog.classList.add('active');
        const okBtn = document.getElementById('confirm-ok');
        const cancelBtn = document.getElementById('confirm-cancel');
        const cleanup = (result) => {
            dialog.classList.remove('active');
            okBtn.onclick = null;
            cancelBtn.onclick = null;
            resolve(result);
        };
        okBtn.onclick = () => cleanup(true);
        cancelBtn.onclick = () => cleanup(false);
    });
}

// ==========================================================================
// MOTOR LÓGICO DE STATUS EM TEMPO REAL
// ==========================================================================
function getCalculatedStatus(t) {
    const today = new Date(); today.setHours(0,0,0,0);
    const start = t.data_inicio ? new Date(t.data_inicio + 'T00:00:00') : today;
    const end = t.data_fim ? new Date(t.data_fim + 'T00:00:00') : today;

    if (t.status === 'concluido') return { id: 'concluida', label: 'CONCLUÍDA', class: 'status-concluida' };
    if (t.status === 'aprovacao') return { id: 'aguardando', label: 'AGUARDANDO OK', class: 'status-aguardando' };
    if (today > end) return { id: 'critica', label: 'CRÍTICA (VENCIDA)', class: 'status-critica' };
    if (t.status === 'andamento') return { id: 'execucao', label: 'EM EXECUÇÃO', class: 'status-execucao' };
    if (today >= start) return { id: 'atrasada', label: 'ATRASADA P/ INICIAR', class: 'status-atrasada' };

    return { id: 'nao_iniciada', label: 'NÃO INICIADA', class: 'status-nao-iniciada' };
}

// Helpers de prioridade
function getPriorityColor(p) {
    if (p === 'alta') return '#dc3545';
    if (p === 'baixa') return '#3730a3';
    return '#b45309'; // media (default)
}

// ==========================================================================
// 1. NAVEGAÇÃO E CONTROLE DE ACESSO
// ==========================================================================
function showSection(sec) {
    document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-link').forEach(btn => btn.classList.remove('active'));

    const targetSection = document.getElementById(`sec-${sec}`);
    if (targetSection) targetSection.classList.add('active');

    const navMap = {
        'hoje': 'btn-nav-hoje',
        'dashboard-bi': 'btn-nav-bi',
        'acompanhamento': 'btn-nav-op',
        'kanban': 'btn-nav-kanban',
        'busca': 'btn-nav-busca',
        'arquivo': 'btn-nav-arquivo',
        'usuarios': 'btn-nav-usuarios',
        'admin': 'btn-nav-admin',
        'novo-projeto': 'btn-nav-novo'
    };
    const btnId = navMap[sec];
    if (btnId && document.getElementById(btnId)) {
        document.getElementById(btnId).classList.add('active');
    }

    if (sec === 'hoje') renderHoje();
    if (sec === 'kanban') renderKanban();
    if (sec === 'usuarios') renderUsers();
    if (sec === 'admin') renderAdminPanel();
    if (sec === 'busca') executarBusca();
    if (sec === 'arquivo') renderArquivo();
}

function updateNavVisibility() {
    const isSuperAdmin = currentUserRole === 'super-admin';
    const isGestorArea = managedAreas.length > 0;
    const isGestorProjeto = managedProjects.length > 0;
    const temPoder = isSuperAdmin || isGestorArea || isGestorProjeto;

    document.getElementById('btn-nav-bi').style.display = 'inline-block';
    document.getElementById('btn-nav-novo').style.display = temPoder ? 'inline-block' : 'none';
    document.getElementById('btn-nav-voz').style.display = temPoder ? 'inline-flex' : 'none';
    document.getElementById('btn-nav-arquivo').style.display = temPoder ? 'inline-block' : 'none';
    document.getElementById('btn-nav-usuarios').style.display = isSuperAdmin ? 'inline-block' : 'none';
    document.getElementById('btn-nav-admin').style.display = isSuperAdmin ? 'inline-block' : 'none';

    const currentActive = document.querySelector('.content-section.active')?.id;
    if (!temPoder && (currentActive === 'sec-novo-projeto' || currentActive === 'sec-admin' || currentActive === 'sec-usuarios')) {
        showSection('hoje');
    }
}

// ==========================================================================
// 2. AUTENTICAÇÃO E CARGA
// ==========================================================================
auth.onAuthStateChanged(async user => {
    if (user) {
        currentUserEmail = user.email.toLowerCase();
        try {
            const userQuery = await db.collection('usuarios').where('email', '==', currentUserEmail).get();
            if (userQuery.empty) {
                toast('Acesso negado. Sua conta não está credenciada no Vetor.', 'error', 5000);
                auth.signOut();
                return;
            }
            const userData = userQuery.docs[0].data();
            currentUserRole = userData.papel || 'membro';
            currentUserNome = userData.nome || currentUserEmail;

            document.getElementById('login-screen').style.display = 'none';
            document.getElementById('app-screen').style.display = 'block';
            document.getElementById('saudacao').innerText = `Olá, ${userData.nome.split(' ')[0]}`;

            loadUsersDatabase();
            loadAreasEstrategicas();
            toast(`Bem-vindo de volta ao Vetor, ${userData.nome.split(' ')[0]}.`, 'success');
        } catch (e) {
            console.error('Falha ao validar credenciais:', e);
            toast('Falha ao validar suas credenciais. Tente novamente.', 'error');
        }
    } else {
        document.getElementById('login-screen').style.display = 'flex';
        document.getElementById('app-screen').style.display = 'none';
    }
});

function logout() { auth.signOut(); }

// Detecção: mobile e Safari precisam de signInWithRedirect (popup é bloqueado por storage partitioning).
function isMobileOrSafari() {
    const ua = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
    const isAndroid = /Android/i.test(ua);
    const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
    return isIOS || isAndroid || isSafari || window.innerWidth < 768;
}

async function fazerLogin() {
    const provider = new firebase.auth.GoogleAuthProvider();
    try {
        if (isMobileOrSafari()) {
            await auth.signInWithRedirect(provider);
        } else {
            await auth.signInWithPopup(provider);
        }
    } catch (e) {
        console.error('Login popup falhou, tentando redirect:', e);
        // Fallback: se popup falhar (bloqueado, etc), tenta redirect.
        try { await auth.signInWithRedirect(provider); }
        catch (err) { toast('Falha ao fazer login. Tente novamente.', 'error'); }
    }
}
document.getElementById('login-btn').onclick = fazerLogin;

// Quando o usuário volta de signInWithRedirect, o Firebase precisa processar o resultado.
// Se for um redirect bem-sucedido, onAuthStateChanged dispara automaticamente.
auth.getRedirectResult().catch(e => {
    if (e.code && e.code !== 'auth/credential-already-in-use') {
        console.error('Falha ao processar redirect de login:', e);
    }
});

function loadAreasEstrategicas() {
    db.collection('areas_estrategicas').onSnapshot(snapshot => {
        allAreasData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        loadDataTasks();
    }, err => {
        console.error('Erro snapshot áreas:', err);
        toast('Falha ao sincronizar áreas estratégicas.', 'error');
    });
}

function loadUsersDatabase() {
    db.collection('usuarios').onSnapshot(snapshot => {
        allUsers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a, b) => a.nome.localeCompare(b.nome));
        populateUserSelectsMaster();
        renderUsers();
        if (document.getElementById('sec-admin').classList.contains('active')) renderAdminPanel();
        migrarUsuariosParaEmailId(); // converte IDs aleatórios para email-as-id
    }, err => {
        console.error('Erro snapshot usuários:', err);
    });
}

function loadDataTasks() {
    db.collection('tarefas').orderBy('criadoEm', 'desc').onSnapshot(snapshot => {
        allTasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        if (currentUserRole === 'super-admin') {
            managedAreas = allAreasData.map(a => a.id);
            managedProjects = [...new Set(allTasks.map(t => t.project))];
        } else {
            managedAreas = allAreasData.filter(a => a.gestores && a.gestores.includes(currentUserEmail)).map(a => a.id);
            const projsPorArea = allTasks.filter(t => managedAreas.includes(t.area)).map(t => t.project);
            const projsDiretos = allTasks.filter(t => t.resps && t.resps.some(r => r.email === currentUserEmail && r.papel === 'gestor')).map(t => t.project);
            managedProjects = [...new Set([...projsPorArea, ...projsDiretos])];
        }

        updateNavVisibility();
        updateProjectAndAreaLists();
        renderDashboard();
        updateBIAreaFilter();
        renderHoje();
        if (document.getElementById('sec-kanban').classList.contains('active')) renderKanban();
        if (document.getElementById('sec-busca').classList.contains('active')) executarBusca();
        if (document.getElementById('sec-arquivo').classList.contains('active')) renderArquivo();
        migrarRespEmails(); // garante resp_emails em tarefas antigas (preparação para Security Rules)
        autoArchiveExpired(); // fallback enquanto Cloud Function não está deployada
    }, err => {
        console.error('Erro snapshot tarefas:', err);
        toast('Falha ao sincronizar tarefas.', 'error');
    });
}

// ==========================================================================
// 3. ABA HOJE — visão pessoal de execução
// ==========================================================================
function renderHoje() {
    const dataLabel = document.getElementById('hojeDataLabel');
    if (dataLabel) {
        const hoje = new Date();
        dataLabel.innerText = hoje.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
    }

    const today = new Date(); today.setHours(0,0,0,0);
    const amanha = new Date(today); amanha.setDate(today.getDate() + 1);

    const minhasTasks = allTasks.filter(t => t.resps && t.resps.some(r => r.email === currentUserEmail));
    const tasksGerencio = allTasks.filter(t =>
        currentUserRole === 'super-admin' ||
        managedAreas.includes(t.area) ||
        managedProjects.includes(t.project)
    );

    const agora = minhasTasks.filter(t => {
        if (t.status === 'concluido') return false;
        const cs = getCalculatedStatus(t);
        if (cs.id === 'critica') return false; // críticas vão para "atrasadas"
        if (t.status === 'andamento') return true;
        if (t.data_fim) {
            const fim = new Date(t.data_fim + 'T00:00:00');
            if (fim <= amanha) return true;
        }
        return false;
    });

    const atrasadas = minhasTasks.filter(t => {
        if (t.status === 'concluido') return false;
        return getCalculatedStatus(t).id === 'critica';
    });

    const validar = tasksGerencio.filter(t => t.status === 'aprovacao');

    renderHojeColuna('hoje-list-agora', 'hoje-count-agora', agora);
    renderHojeColuna('hoje-list-atraso', 'hoje-count-atraso', atrasadas);
    renderHojeColuna('hoje-list-validar', 'hoje-count-validar', validar);

    const cardValidar = document.getElementById('hoje-card-validar');
    if (cardValidar) cardValidar.style.display = (currentUserRole === 'super-admin' || managedAreas.length > 0 || managedProjects.length > 0) ? 'block' : 'none';

    const resumo = document.getElementById('hoje-resumo');
    if (resumo) resumo.style.display = (agora.length + atrasadas.length + validar.length) > 0 ? 'flex' : 'none';
}

function renderHojeColuna(listId, countId, tasks) {
    const lista = document.getElementById(listId);
    const countEl = document.getElementById(countId);
    if (!lista) return;
    countEl.innerText = tasks.length;

    if (tasks.length === 0) {
        lista.innerHTML = '<div class="hoje-item-empty">Nada por aqui. Bom trabalho!</div>';
        return;
    }

    lista.innerHTML = tasks.map(t => {
        const cs = getCalculatedStatus(t);
        const prazo = t.data_fim ? t.data_fim.split('-').reverse().join('/') : '—';
        const respNomes = t.resps && t.resps.length > 0 ? t.resps.map(r => r.nome.split(' ')[0]).join(', ') : '—';
        return `<div class="hoje-item" onclick="abrirModal('${t.id}')">
            <div class="hoje-item-title">${escapeHtml(t.text)}</div>
            <div class="hoje-item-meta">
                <span>📁 ${escapeHtml(t.project)}</span>
                <span>📅 ${prazo}</span>
                <span class="status-pill ${cs.class}" style="font-size:9px;">${cs.label}</span>
            </div>
        </div>`;
    }).join('');
}

function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ==========================================================================
// 4. ADMINISTRAÇÃO AVANÇADA
// ==========================================================================
function renderAdminPanel() {
    if (currentUserRole !== 'super-admin') return;

    const formalAreas = allAreasData.map(a => a.id);
    const inferredAreas = [...new Set(allTasks.map(t => t.area).filter(a => a && a !== 'Sem Área'))];
    const allCombinedAreas = [...new Set([...formalAreas, ...inferredAreas])].sort((a, b) => a.localeCompare(b));

    let areaOptions = '<option value="">Selecione a área para editar ou formalizar...</option>';
    areaOptions += '<option value="NOVA_AREA" style="font-weight:bold; color:#2563eb;">+ CRIAR NOVA ÁREA ESTRATÉGICA</option>';
    allCombinedAreas.forEach(a => {
        const isGhost = !formalAreas.includes(a) ? '  (FANTASMA - Formalize)' : '';
        areaOptions += `<option value="${a}">${a}${isGhost}</option>`;
    });
    document.getElementById('adminAreaSelect').innerHTML = areaOptions;

    const container = document.getElementById('adminAreaGestoresContainer');
    container.innerHTML = allUsers.map(u => `
        <label class="admin-gestor-row" style="cursor: pointer;">
            <span class="bold">${escapeHtml(u.nome)}</span>
            <input type="checkbox" class="admin-gestor-check" value="${u.email}">
        </label>
    `).join('');

    let htmlAreas = '';
    allCombinedAreas.forEach(a => {
        const formalData = allAreasData.find(doc => doc.id === a);
        if (formalData) {
            const gNomes = formalData.gestores && formalData.gestores.length > 0 ? formalData.gestores.map(email => {
                const u = allUsers.find(user => user.email === email);
                return u ? u.nome.split(' ')[0] : email;
            }).join(', ') : 'Nenhum';

            htmlAreas += `
            <div style="padding: 12px 15px; border: 1px solid #e2e8f0; border-radius: 6px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; background: #fff;">
                <div><strong style="font-size: 14px; color: #0f172a;">${escapeHtml(a)}</strong><br><span style="color:#64748b; font-size:10px; font-weight:700;">GESTORES: <span style="font-weight:500; color:#334155;">${escapeHtml(gNomes.toUpperCase())}</span></span></div>
                <button onclick="deletarArea('${escapeHtml(a)}')" style="background: #fff5f5; border: 1px solid #fc8181; color: #c53030; padding: 6px 12px; border-radius: 4px; font-size: 10px; font-weight: bold; cursor: pointer;">EXCLUIR</button>
            </div>`;
        } else {
            htmlAreas += `
            <div style="padding: 12px 15px; border: 1px dashed #f59e0b; border-radius: 6px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; background: #fffbeb;">
                <div><strong style="font-size: 14px; color: #92400e;">${escapeHtml(a)}</strong><br><span style="color:#d97706; font-size:10px; font-weight:bold;">[ FANTASMA ]</span></div>
            </div>`;
        }
    });
    document.getElementById('admin-areas-list').innerHTML = htmlAreas;

    const projs = {};
    allTasks.forEach(t => { projs[t.project] = t.area || 'Sem Área'; });

    let htmlProjs = '';
    Object.keys(projs).sort((a, b) => a.localeCompare(b)).forEach(p => {
        htmlProjs += `<div onclick="prepararEdicaoProjeto('${escapeHtml(p)}', '${escapeHtml(projs[p])}')" style="padding: 10px; border-bottom: 1px solid #eee; cursor: pointer; display: flex; justify-content: space-between; align-items: center;"><strong style="font-size: 13px;">${escapeHtml(p)}</strong><span class="status-pill status-fazer" style="font-size: 9px;">${escapeHtml(projs[p])}</span></div>`;
    });
    document.getElementById('admin-projects-list').innerHTML = htmlProjs;
    document.getElementById('adminProjectNewArea').innerHTML = '<option value="">Deixar Sem Área</option>' + allCombinedAreas.map(a => `<option value="${a}">${a}</option>`).join('');
}

function tratarSelecaoAreaAdmin() {
    const select = document.getElementById('adminAreaSelect');
    const input = document.getElementById('adminAreaInput');
    if (select.value === 'NOVA_AREA') { input.style.display = 'block'; input.focus(); document.querySelectorAll('.admin-gestor-check').forEach(cb => cb.checked = false); }
    else { input.style.display = 'none'; input.value = ''; carregarGestoresArea(select.value); }
}

function carregarGestoresArea(areaId) {
    const areaExists = allAreasData.find(a => a.id === areaId);
    document.querySelectorAll('.admin-gestor-check').forEach(cb => { cb.checked = (areaExists && areaExists.gestores && areaExists.gestores.includes(cb.value)); });
}

async function salvarAreaEstrategica() {
    const selectVal = document.getElementById('adminAreaSelect').value;
    const inputVal = document.getElementById('adminAreaInput').value.trim();
    let nomeArea = selectVal === 'NOVA_AREA' ? inputVal : selectVal;
    if (!nomeArea) return toast('Defina um nome para a área.', 'warning');
    const gestoresSelecionados = Array.from(document.querySelectorAll('.admin-gestor-check:checked')).map(cb => cb.value);
    try {
        await db.collection('areas_estrategicas').doc(nomeArea).set({ gestores: gestoresSelecionados });
        document.getElementById('adminAreaSelect').value = '';
        document.getElementById('adminAreaInput').style.display = 'none';
        document.getElementById('adminAreaInput').value = '';
        document.querySelectorAll('.admin-gestor-check').forEach(cb => cb.checked = false);
        renderAdminPanel();
        toast('Área salva com sucesso.', 'success');
    } catch (e) {
        console.error(e);
        toast('Falha ao salvar a área. Verifique suas permissões.', 'error');
    }
}

async function deletarArea(idArea) {
    const ok = await vetorConfirm(`Excluir a área "${idArea}"? As tarefas vinculadas continuarão existindo, mas perderão a referência formal.`, 'Excluir área');
    if (!ok) return;
    try {
        await db.collection('areas_estrategicas').doc(idArea).delete();
        toast('Área excluída.', 'success');
    } catch (e) {
        toast('Falha ao excluir área.', 'error');
    }
}

function prepararEdicaoProjeto(projName, currArea) {
    document.getElementById('admin-edit-project-form').style.display = 'block';
    document.getElementById('adminEditProjTarget').innerText = projName;
    document.getElementById('adminNewProjectName').value = projName;
    document.getElementById('adminProjectNewArea').value = currArea !== 'Sem Área' ? currArea : '';
    document.getElementById('admin-edit-project-form').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function cancelarEdicaoProjetoAdmin() { document.getElementById('admin-edit-project-form').style.display = 'none'; }

async function refatorarProjetoCascata() {
    const oldName = document.getElementById('adminEditProjTarget').innerText;
    const newNameInput = document.getElementById('adminNewProjectName').value.trim();
    const newArea = document.getElementById('adminProjectNewArea').value;
    if (!oldName) return;
    const finalName = newNameInput || oldName;

    const ok = await vetorConfirm(`Você vai reescrever TODAS as tarefas de "${oldName}". Confirma?`, 'Aplicar em cascata');
    if (!ok) return;

    try {
        const batch = db.batch();
        const snapshot = await db.collection('tarefas').where('project', '==', oldName).get();
        if (snapshot.empty) { toast('Nenhuma tarefa encontrada para refatorar.', 'warning'); return; }
        snapshot.forEach(doc => {
            const updateData = { project: finalName, area: newArea || firebase.firestore.FieldValue.delete() };
            batch.update(doc.ref, updateData);
        });
        await batch.commit();
        cancelarEdicaoProjetoAdmin();
        toast(`Cascata aplicada em ${snapshot.size} tarefa(s).`, 'success');
        renderAdminPanel();
    } catch (e) {
        console.error(e);
        toast('Erro ao processar lote.', 'error');
    }
}

// ==========================================================================
// 5. GESTÃO DE EQUIPE
// ==========================================================================
// Normalizador de telefone (formato BR / E.164 best-effort)
function normalizarTelefone(t) {
    if (!t) return '';
    const limpo = String(t).replace(/[^\d+]/g, '');
    if (!limpo) return '';
    // Se já vem com +, mantém. Se não, e tem 10/11 dígitos, prefixa +55.
    if (limpo.startsWith('+')) return limpo;
    if (limpo.length === 10 || limpo.length === 11) return '+55' + limpo;
    return limpo.startsWith('55') ? '+' + limpo : limpo;
}

async function cadastrarUsuario() {
    const nome = document.getElementById('novoUserNome').value.trim();
    const email = document.getElementById('novoUserEmail').value.toLowerCase().trim();
    const telefone = normalizarTelefone(document.getElementById('novoUserTelefone').value.trim());
    if (!nome || !email) return toast('Preencha nome e e-mail.', 'warning');
    try {
        // ID do documento = email (necessário para Security Rules conseguirem checar via exists())
        await db.collection('usuarios').doc(email).set({ nome, email, telefone, papel: 'membro' });
        document.getElementById('novoUserNome').value = '';
        document.getElementById('novoUserEmail').value = '';
        document.getElementById('novoUserTelefone').value = '';
        toast(`${nome} liberado para usar o Vetor.`, 'success');
    } catch (e) {
        toast('Falha ao credenciar membro.', 'error');
    }
}

function renderUsers() {
    const board = document.getElementById('lista-usuarios-board');
    if (!board) return;
    const isSuperAdmin = currentUserRole === 'super-admin';

    let html = `<div class="table-container shadow"><table><thead><tr>
        <th>Nome</th><th>E-mail</th><th>WhatsApp</th><th>Papel</th><th style="text-align:right">Ações</th>
    </tr></thead><tbody>`;
    allUsers.forEach(u => {
        const tel = u.telefone
            ? `<span style="font-family:monospace; font-size:12px;">${escapeHtml(u.telefone)}</span>`
            : `<span style="background:#fef3c7; color:#92400e; padding:2px 8px; border-radius:100px; font-size:10px; font-weight:700;">SEM WHATSAPP</span>`;
        const papelBadge = u.papel === 'super-admin'
            ? `<span class="priority-pill prio-alta" style="opacity:1;">Super-admin</span>`
            : `<span class="priority-pill prio-baixa" style="opacity:1;">Membro</span>`;
        const isMe = u.email === currentUserEmail;
        let acoes = '';
        if (isSuperAdmin) {
            acoes += `<button onclick="abrirEdicaoMembro('${u.id}')" class="btn-secondary" style="margin-right:6px;">EDITAR</button>`;
            if (!isMe) acoes += `<button onclick="removerUsuario('${u.id}')" class="btn-danger">REMOVER</button>`;
            else acoes += '<small>(Você)</small>';
        } else if (!isMe) {
            acoes = '<small style="color:#94a3b8;">—</small>';
        } else {
            acoes = '<small>(Você)</small>';
        }
        html += `<tr><td class="bold">${escapeHtml(u.nome)}</td><td>${escapeHtml(u.email)}</td>
            <td>${tel}</td><td>${papelBadge}</td>
            <td style="text-align:right">${acoes}</td></tr>`;
    });
    board.innerHTML = html + `</tbody></table></div>`;
}

async function removerUsuario(id) {
    const ok = await vetorConfirm('Revogar acesso deste membro?', 'Revogar acesso');
    if (!ok) return;
    try {
        await db.collection('usuarios').doc(id).delete();
        toast('Acesso revogado.', 'success');
    } catch (e) {
        toast('Falha ao revogar acesso.', 'error');
    }
}

// ==========================================================================
// EDIÇÃO DE MEMBRO PELO ADMIN — preencher WhatsApp, mudar papel/nome
// ==========================================================================
function abrirEdicaoMembro(id) {
    if (currentUserRole !== 'super-admin') return;
    const u = allUsers.find(x => x.id === id);
    if (!u) return;
    document.getElementById('editMembroId').value = u.id;
    document.getElementById('editMembroNome').value = u.nome || '';
    document.getElementById('editMembroEmail').value = u.email || '';
    document.getElementById('editMembroTelefone').value = u.telefone || '';
    const papel = u.papel || 'membro';
    document.querySelectorAll('input[name="editMembroPapel"]').forEach(r => {
        r.checked = (r.value === papel);
    });
    document.getElementById('editarMembroModal').classList.add('active');
}

function fecharEdicaoMembro() {
    document.getElementById('editarMembroModal').classList.remove('active');
}

async function salvarEdicaoMembro() {
    const id = document.getElementById('editMembroId').value;
    const nome = document.getElementById('editMembroNome').value.trim();
    const tel = normalizarTelefone(document.getElementById('editMembroTelefone').value.trim());
    const papel = document.querySelector('input[name="editMembroPapel"]:checked')?.value || 'membro';
    if (!nome) return toast('Nome não pode ficar vazio.', 'warning');

    // Proteção contra rebaixar a si mesmo (perderia acesso ao admin)
    const u = allUsers.find(x => x.id === id);
    if (u && u.email === currentUserEmail && papel !== 'super-admin') {
        const confirmar = await vetorConfirm(
            'Atenção: você está rebaixando sua própria conta. Vai perder acesso ao painel Admin imediatamente. Confirma?',
            'Rebaixar a si mesmo'
        );
        if (!confirmar) return;
    }

    try {
        await db.collection('usuarios').doc(id).update({ nome, telefone: tel, papel });
        toast('Membro atualizado.', 'success');
        fecharEdicaoMembro();
    } catch (e) {
        console.error(e);
        toast('Falha ao salvar. Verifique suas permissões.', 'error');
    }
}

// ==========================================================================
// MEU PERFIL — auto-cadastro de telefone WhatsApp
// ==========================================================================
function abrirMeuPerfil() {
    if (!currentUserEmail) return;
    const u = allUsers.find(x => x.email === currentUserEmail);
    if (!u) return;
    document.getElementById('perfilNome').value = u.nome || '';
    document.getElementById('perfilEmail').value = u.email || '';
    document.getElementById('perfilTelefone').value = u.telefone || '';
    document.getElementById('perfilModal').classList.add('active');
}
function fecharMeuPerfil() {
    document.getElementById('perfilModal').classList.remove('active');
}
async function salvarMeuPerfil() {
    const u = allUsers.find(x => x.email === currentUserEmail);
    if (!u) return;
    const tel = normalizarTelefone(document.getElementById('perfilTelefone').value.trim());
    try {
        await db.collection('usuarios').doc(u.id).update({ telefone: tel });
        toast('Perfil atualizado.', 'success');
        fecharMeuPerfil();
    } catch (e) {
        console.error(e);
        toast('Falha ao salvar perfil. Verifique suas permissões.', 'error');
    }
}

// ==========================================================================
// 6. INCLUSÃO DE TAREFAS
// ==========================================================================
function populateUserSelectsMaster() {
    const optionsHTML = '<option value="">Selecione...</option>' + allUsers.map(u => `<option value="${u.email}">${escapeHtml(u.nome)}</option>`).join('');
    document.querySelectorAll('.resp-select').forEach(sel => {
        const currentVal = sel.value;
        sel.innerHTML = optionsHTML;
        sel.value = currentVal;
    });
}

function addResponsavelField(containerId, presetEmail = "", presetRole = "executor") {
    const container = document.getElementById(containerId);
    const div = document.createElement('div');
    div.className = 'resp-row';
    div.style = "display: flex; gap: 10px; align-items: center; margin-bottom: 5px;";

    const optionsHTML = '<option value="">Selecione o Membro...</option>' + allUsers.map(u => `<option value="${u.email}" ${u.email === presetEmail ? 'selected' : ''}>${escapeHtml(u.nome)}</option>`).join('');

    div.innerHTML = `
        <select class="resp-select" style="flex: 2;">${optionsHTML}</select>
        <select class="resp-role" style="flex: 1;">
            <option value="executor" ${presetRole === 'executor' ? 'selected' : ''}>Executor</option>
            <option value="gestor" ${presetRole === 'gestor' ? 'selected' : ''}>Gestor do Projeto</option>
        </select>
        <button onclick="this.parentElement.remove()" class="btn-remove-resp" title="Remover" aria-label="Remover">&times;</button>
    `;
    container.appendChild(div);
}

function coletarEquipeDeContainer(containerId) {
    const resps = [];
    document.getElementById(containerId).querySelectorAll('.resp-row').forEach(row => {
        const email = row.querySelector('.resp-select').value;
        const papel = row.querySelector('.resp-role').value;
        if (email) {
            const userObj = allUsers.find(u => u.email === email);
            if (userObj && !resps.find(r => r.email === userObj.email)) {
                resps.push({ nome: userObj.nome, email: userObj.email, papel: papel });
            }
        }
    });
    return resps;
}

function tratarSelecaoAreaNovoProjeto() {
    const areaSelect = document.getElementById('areaInput');
    const projSelect = document.getElementById('projectSelect');
    const projInput = document.getElementById('projectInputNovo');
    if (!areaSelect || !projSelect) return;

    const selectedArea = areaSelect.value;
    projSelect.innerHTML = '';
    projInput.style.display = 'none';
    projInput.value = '';

    if (!selectedArea) {
        projSelect.innerHTML = '<option value="">Selecione a Área primeiro...</option>';
        return;
    }

    let projsInArea = allTasks.filter(t => (t.area || 'Sem Área') === selectedArea).map(t => t.project);
    if (currentUserRole !== 'super-admin') { projsInArea = projsInArea.filter(p => managedProjects.includes(p)); }

    const uniqueProjs = [...new Set(projsInArea)].sort((a, b) => a.localeCompare(b));

    let html = '<option value="">Selecione um Projeto existente...</option>';
    html += '<option value="NOVO_PROJETO" style="font-weight:bold; color:#2563eb;">+ CRIAR NOVO PROJETO</option>';
    uniqueProjs.forEach(p => { html += `<option value="${p}">${p}</option>`; });

    projSelect.innerHTML = html;
}

function tratarSelecaoProjetoNovo() {
    const projSelect = document.getElementById('projectSelect');
    const projInput = document.getElementById('projectInputNovo');
    if (projSelect.value === 'NOVO_PROJETO') { projInput.style.display = 'block'; projInput.focus(); }
    else { projInput.style.display = 'none'; projInput.value = ''; }
}

async function saveDemand() {
    const area = document.getElementById('areaInput').value;
    const projSelectVal = document.getElementById('projectSelect').value;
    const projInputVal = document.getElementById('projectInputNovo').value.trim();
    const project = projSelectVal === 'NOVO_PROJETO' ? projInputVal : projSelectVal;

    const title = document.getElementById('taskTitle').value.trim();
    const desc = document.getElementById('taskDesc').value.trim();
    const dateStart = document.getElementById('dateInputStart').value;
    const dateEnd = document.getElementById('dateInputEnd').value;
    const prioridade = document.querySelector('input[name="prioridadeNovo"]:checked')?.value || 'media';

    if (currentUserRole !== 'super-admin' && !managedAreas.includes(area) && !managedProjects.includes(project) && projSelectVal !== 'NOVO_PROJETO') {
        return toast('Acesso negado: sem permissão nesta área/projeto.', 'error');
    }

    const resps = coletarEquipeDeContainer('responsaveis-container');
    if (!area || !project || !title || resps.length === 0 || !dateStart || !dateEnd) {
        return toast('Preencha Área, Projeto, Título, Datas e Responsável.', 'warning');
    }

    try {
        const batch = db.batch();
        for (const r of resps) {
            const newDocRef = db.collection('tarefas').doc();
            batch.set(newDocRef, {
                area, project, text: title, descricao: desc, data_inicio: dateStart, data_fim: dateEnd,
                status: 'fazer', prioridade,
                resps: [r],
                resp_emails: [r.email], // desnormalizado para Security Rules
                criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
                historico: [], email: r.email, criadoPor: currentUserEmail
            });
        }
        await batch.commit();

        // Notificações via Cloud Function (Resend + WhatsApp). Falha silenciosa: tarefa já foi salva.
        try {
            const fn = functions.httpsCallable('sendNotification');
            await fn({
                destinatarios: resps.map(r => r.email),
                tipo: 'NOVA DEMANDA',
                saudacao: '',
                mensagem: `Você foi atribuído a uma nova demanda no Vetor:\n\n` +
                          `**${title}**\nProjeto: ${project}\nÁrea: ${area}\n` +
                          `Início: ${dateStart} | Prazo: ${dateEnd}\n\n` +
                          `Acesse o Vetor para ver os detalhes.`
            });
        } catch (e) { console.warn('Notificação não enviada (Cloud Function indisponível?):', e); }

        toast(`${resps.length} demanda(s) lançada(s) no Vetor.`, 'success');
        document.getElementById('taskTitle').value = '';
        document.getElementById('taskDesc').value = '';
        document.getElementById('responsaveis-container').innerHTML = '';
        addResponsavelField('responsaveis-container');
        showSection('acompanhamento');
    } catch (e) {
        console.error(e);
        toast('Erro ao lançar as demandas. Verifique suas permissões.', 'error');
    }
}

async function duplicarTask() {
    const t = allTasks.find(x => x.id === currentTaskId);
    if (!t) return;
    const ok = await vetorConfirm(`Criar uma cópia da demanda "${t.text}"?`, 'Clonar demanda');
    if (!ok) return;

    try {
        const batch = db.batch();
        const newDocRef = db.collection('tarefas').doc();
        batch.set(newDocRef, {
            area: t.area || "Sem Área", project: t.project, text: t.text, descricao: t.descricao || "",
            data_inicio: t.data_inicio || "", data_fim: t.data_fim || "",
            status: 'fazer', prioridade: t.prioridade || 'media',
            resps: t.resps || [],
            resp_emails: (t.resps || []).map(r => r.email).filter(Boolean),
            criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
            historico: [{ data: new Date().toLocaleString('pt-BR'), autor: "SISTEMA", texto: `Demanda duplicada.` }],
            email: t.email || (t.resps && t.resps.length > 0 ? t.resps[0].email : ""),
            criadoPor: currentUserEmail
        });
        await batch.commit();
        toast('Demanda clonada.', 'success');
        abrirModal(newDocRef.id);
    } catch (e) {
        toast('Erro ao clonar demanda.', 'error');
    }
}

// ==========================================================================
// 7. VISÃO OPERACIONAL E MODAL
// ==========================================================================
// Por padrão, tarefas arquivadas são removidas das visões.
// Para acessá-las, use getAllTasksIncludingArchived().
function getVisibleTasksBoard() {
    let base;
    if (currentUserRole === 'super-admin') base = allTasks;
    else base = allTasks.filter(t => managedAreas.includes(t.area) || managedProjects.includes(t.project) || (t.resps && t.resps.some(r => r.email === currentUserEmail)));
    return base.filter(t => !t.arquivada);
}

function getArchivedTasks() {
    let base;
    if (currentUserRole === 'super-admin') base = allTasks;
    else base = allTasks.filter(t => managedAreas.includes(t.area) || managedProjects.includes(t.project) || (t.resps && t.resps.some(r => r.email === currentUserEmail)));
    return base.filter(t => t.arquivada === true);
}

function updateProjectAndAreaLists() {
    const areaSelect = document.getElementById('areaInput');
    let allowedAreas = [];
    if (currentUserRole === 'super-admin') {
        const formal = allAreasData.map(a => a.id);
        const inferred = allTasks.map(t => t.area).filter(a => a && a !== 'Sem Área');
        allowedAreas = [...new Set([...formal, ...inferred])].sort((a, b) => a.localeCompare(b));
    } else {
        allowedAreas = managedAreas.sort((a, b) => a.localeCompare(b));
    }

    if (areaSelect) {
        const currentVal = areaSelect.value;
        areaSelect.innerHTML = '<option value="">Selecione a Área...</option>' + allowedAreas.map(a => `<option value="${a}">${a}</option>`).join('');
        if (currentVal && allowedAreas.includes(currentVal)) areaSelect.value = currentVal;
        tratarSelecaoAreaNovoProjeto();
    }

    const filterAreaOp = document.getElementById('filterAreaOp');
    if (filterAreaOp) {
        const currArea = filterAreaOp.value;
        filterAreaOp.innerHTML = '<option value="geral">Todas as Áreas</option>' + allowedAreas.map(a => `<option value="${a}">${a}</option>`).join('');
        if (currArea && allowedAreas.includes(currArea)) filterAreaOp.value = currArea;
    }

    // Kanban
    const kanbanArea = document.getElementById('kanbanAreaFilter');
    if (kanbanArea) {
        const currK = kanbanArea.value;
        kanbanArea.innerHTML = '<option value="geral">Todas as Áreas</option>' + allowedAreas.map(a => `<option value="${a}">${a}</option>`).join('');
        if (currK && allowedAreas.includes(currK)) kanbanArea.value = currK;
    }

    updateOpProjectFilter();
    updateKanbanProjectFilter();
}

function updateOpProjectFilter() {
    const filterAreaOp = document.getElementById('filterAreaOp');
    const filterProjectOp = document.getElementById('filterProjectOp');
    if (!filterAreaOp || !filterProjectOp) return;

    const selectedArea = filterAreaOp.value;
    let tasks = getVisibleTasksBoard();
    if (selectedArea !== 'geral') { tasks = tasks.filter(t => (t.area || 'Sem Área') === selectedArea); }

    const projects = [...new Set(tasks.map(t => t.project))].sort((a, b) => a.localeCompare(b));
    const currProj = filterProjectOp.value;

    filterProjectOp.innerHTML = '<option value="geral">Todos os Projetos</option>' + projects.map(p => `<option value="${p}">${p}</option>`).join('');
    if (currProj && projects.includes(currProj)) filterProjectOp.value = currProj;
    renderDashboard();
}

function updateKanbanProjectFilter() {
    const ka = document.getElementById('kanbanAreaFilter');
    const kp = document.getElementById('kanbanProjectFilter');
    if (!ka || !kp) return;
    const selectedArea = ka.value || 'geral';
    let tasks = getVisibleTasksBoard();
    if (selectedArea !== 'geral') tasks = tasks.filter(t => (t.area || 'Sem Área') === selectedArea);
    const projs = [...new Set(tasks.map(t => t.project))].sort((a, b) => a.localeCompare(b));
    const currP = kp.value;
    kp.innerHTML = '<option value="geral">Todos os Projetos</option>' + projs.map(p => `<option value="${p}">${p}</option>`).join('');
    if (currP && projs.includes(currP)) kp.value = currP;
    if (document.getElementById('sec-kanban').classList.contains('active')) renderKanban();
}

function getFilteredOperationalTasks() {
    const tasks = getVisibleTasksBoard();
    const selectedArea = document.getElementById('filterAreaOp')?.value || 'geral';
    const selectedProject = document.getElementById('filterProjectOp')?.value || 'geral';
    return tasks.filter(t => {
        const matchArea = selectedArea === 'geral' || (t.area || 'Sem Área') === selectedArea;
        const matchProj = selectedProject === 'geral' || t.project === selectedProject;
        return matchArea && matchProj;
    });
}

function renderDashboard() {
    const filtered = getFilteredOperationalTasks();
    const todayZero = new Date(); todayZero.setHours(0,0,0,0);

    const stats = {
        total: filtered.length,
        criticas: filtered.filter(t => t.status !== 'concluido' && t.data_fim && new Date(t.data_fim + 'T00:00:00') < todayZero).length,
        pendentes: filtered.filter(t => t.status === 'aprovacao').length,
        concluidas: filtered.filter(t => t.status === 'concluido').length
    };

    const sg = document.getElementById('stats-grid');
    if (sg) {
        sg.innerHTML = `
        <div class="stat-card shadow"><h3>${stats.total}</h3><p>Demandas</p></div>
        <div class="stat-card shadow" style="border-left:4px solid #dc3545"><h3>${stats.criticas}</h3><p>Críticas (Vencidas)</p></div>
        <div class="stat-card shadow" style="border-left:4px solid #f59e0b"><h3>${stats.pendentes}</h3><p>Aguardando Validação</p></div>
        <div class="stat-card shadow" style="border-left:4px solid #10b981"><h3>${stats.concluidas}</h3><p>Concluídas</p></div>`;
    }
    renderBoard(filtered);
}

function renderBoard(filteredTasks) {
    const board = document.getElementById('projectsBoard');
    if (!board) return;
    if (filteredTasks.length === 0) {
        board.innerHTML = '<p style="padding: 30px; text-align: center; color: #888;">Nenhuma demanda encontrada.</p>';
        return;
    }

    const grouped = {};
    filteredTasks.forEach(t => { if (!grouped[t.project]) grouped[t.project] = []; grouped[t.project].push(t); });

    let html = '';
    Object.keys(grouped).sort((a, b) => a.localeCompare(b)).forEach(projName => {
        const projArea = grouped[projName][0].area || 'Sem Área';
        html += `<div style="background: #f8fafc; padding: 12px 20px; border-bottom: 1px solid var(--border-color); margin-top: 15px;">
                    <h4 style="margin: 0; font-size: 13px; text-transform: uppercase;">📁 ${escapeHtml(projName)} <span style="font-weight:400; color:#64748b; font-size:10px;">(${escapeHtml(projArea)})</span></h4>
                 </div><table style="margin-bottom: 0;"><thead><tr><th style="width:40%">Tarefa</th><th style="width:20%">Prazo</th><th style="width:20%">Responsável</th><th style="width:20%">Status</th></tr></thead><tbody>`;

        grouped[projName].forEach(t => {
            const calcStatus = getCalculatedStatus(t);
            const respNames = t.resps && t.resps.length > 0 ? t.resps.map(r => r.nome.split(' ')[0]).join(', ') : '-';
            html += `<tr onclick="abrirModal('${t.id}')" style="cursor:pointer">
                <td class="bold">${escapeHtml(t.text)}</td><td>${t.data_fim ? t.data_fim.split('-').reverse().join('/') : 'N/D'}</td>
                <td style="font-size: 11px;">${escapeHtml(respNames)}</td><td><span class="status-pill ${calcStatus.class}">${calcStatus.label}</span></td></tr>`;
        });
        html += `</tbody></table>`;
    });
    board.innerHTML = html;
}

function revealInteractionPanel() {
    document.getElementById('btn-interact').style.display = 'none';
    document.getElementById('interaction-panel').style.display = 'block';
    document.getElementById('modal-action-footer').style.display = 'flex';
}

function abrirModal(id) {
    closeDrilldown();
    currentTaskId = id;
    const t = allTasks.find(x => x.id === id);
    if (!t) return;
    document.getElementById('taskModal').classList.add('active');

    document.getElementById('btn-interact').style.display = 'block';
    document.getElementById('interaction-panel').style.display = 'none';
    document.getElementById('modal-action-footer').style.display = 'none';
    document.getElementById('ai-analise-box').style.display = 'none';
    document.getElementById('ai-analise-box').innerHTML = '';

    const isGestorPleno = currentUserRole === 'super-admin' || managedAreas.includes(t.area) || managedProjects.includes(t.project);

    document.getElementById('editArea').value = t.area || "Sem Área";
    document.getElementById('editProject').value = t.project || "Sem Projeto";

    document.getElementById('editTitle').value = t.text;
    document.getElementById('editTitle').disabled = !isGestorPleno;
    document.getElementById('editDateStart').value = t.data_inicio || "";
    document.getElementById('editDateStart').disabled = !isGestorPleno;
    document.getElementById('editDateEnd').value = t.data_fim || "";
    document.getElementById('editDateEnd').disabled = !isGestorPleno;
    document.getElementById('editDesc').value = t.descricao || "";

    // Prioridade
    const prio = t.prioridade || 'media';
    document.querySelectorAll('input[name="prioridadeEdit"]').forEach(r => {
        r.checked = (r.value === prio);
        r.disabled = !isGestorPleno;
    });

    const statusSelect = document.getElementById('editStatus');
    statusSelect.innerHTML = `
        <option value="fazer">Não Iniciada</option>
        <option value="andamento">Em Execução</option>
        <option value="aprovacao">Aguardando Validação</option>
    `;
    if (isGestorPleno || t.status === 'concluido') { statusSelect.innerHTML += `<option value="concluido">Concluída</option>`; }
    statusSelect.value = t.status;

    const containerResps = document.getElementById('edit-responsaveis-container');
    containerResps.innerHTML = '';
    if (t.resps) { t.resps.forEach(r => addResponsavelField('edit-responsaveis-container', r.email, r.papel)); }

    document.getElementById('gestor-equipe-panel').style.display = isGestorPleno ? 'block' : 'none';
    document.getElementById('btn-add-edit-resp').style.display = isGestorPleno ? 'inline-block' : 'none';
    document.querySelectorAll('#edit-responsaveis-container select').forEach(sel => sel.disabled = !isGestorPleno);
    document.querySelectorAll('.btn-remove-resp').forEach(btn => btn.style.display = isGestorPleno ? 'inline-block' : 'none');

    document.getElementById('btn-delete-task').style.display = isGestorPleno ? 'inline-block' : 'none';
    document.getElementById('btn-duplicar-task').style.display = isGestorPleno ? 'inline-block' : 'none';

    // Botões IA: só para gestor pleno
    document.getElementById('btn-ai-analise').style.display = isGestorPleno ? 'inline-flex' : 'none';
    document.getElementById('btn-cobrar-ia').style.display = isGestorPleno ? 'inline-block' : 'none';

    // Histórico
    const hist = document.getElementById('modalHistorico');
    hist.innerHTML = (t.historico && t.historico.length > 0) ? t.historico.map(h => {
        let autorNome = h.autor;
        let isSystem = h.autor === "SISTEMA";
        if (!isSystem && autorNome.includes('@')) {
            const u = allUsers.find(user => user.email === autorNome);
            autorNome = u ? u.nome : autorNome.split('@')[0];
        }
        return `<div class="history-item ${isSystem ? 'history-system' : ''}">
                    <div class="history-header"><span class="history-author">${escapeHtml(autorNome)}</span><span class="history-date">${escapeHtml(h.data)}</span></div>
                    <div class="history-body">${escapeHtml(h.texto)}</div>
                </div>`;
    }).join('') : "<em style='color:#94a3b8; font-size: 12px; display: block; text-align: center; padding: 10px 0;'>Nenhuma interação registrada.</em>";
}

function closeModal() { document.getElementById('taskModal').classList.remove('active'); }

document.addEventListener('keydown', (e) => {
    if (e.key === "Escape") {
        closeModal();
        if (typeof closeDrilldown === "function") closeDrilldown();
        document.getElementById('confirm-dialog').classList.remove('active');
        document.getElementById('vozModal').classList.remove('active');
    }
});
window.onclick = function(e) {
    if (!e.target.matches('.dropdown-btn') && !e.target.closest('.dropdown-content')) { document.querySelectorAll('.dropdown-content.show').forEach(el => el.classList.remove('show')); }
    if (e.target.classList.contains('modal')) { closeModal(); closeDrilldown(); }
};

async function saveModalChanges() {
    const t = allTasks.find(x => x.id === currentTaskId);
    if (!t) return;
    const isGestorPleno = currentUserRole === 'super-admin' || managedAreas.includes(t.area) || managedProjects.includes(t.project);
    const report = document.getElementById('newReport').value.trim();

    const currentStatus = document.getElementById('editStatus').value;
    const currentTitle = document.getElementById('editTitle').value.trim();
    const currentDataInicio = document.getElementById('editDateStart').value;
    const currentDataFim = document.getElementById('editDateEnd').value;
    const currentPrio = document.querySelector('input[name="prioridadeEdit"]:checked')?.value || 'media';
    const currentResps = isGestorPleno ? coletarEquipeDeContainer('edit-responsaveis-container') : t.resps;

    let hasAnyChange = false;
    if (report !== "") hasAnyChange = true;
    if (currentStatus !== t.status) hasAnyChange = true;
    if (isGestorPleno) {
        if (currentTitle !== t.text) hasAnyChange = true;
        if (currentDataInicio !== (t.data_inicio || "")) hasAnyChange = true;
        if (currentDataFim !== (t.data_fim || "")) hasAnyChange = true;
        if (currentPrio !== (t.prioridade || 'media')) hasAnyChange = true;
        const cRespsStr = JSON.stringify(currentResps.map(r => r.email).sort());
        const tRespsStr = JSON.stringify((t.resps || []).map(r => r.email).sort());
        if (cRespsStr !== tRespsStr) hasAnyChange = true;
    }

    if (!hasAnyChange) {
        const manter = await vetorConfirm('Nenhuma alteração detectada. Salvar mesmo assim?', 'Sem alterações');
        if (!manter) return; else { closeModal(); return; }
    }

    const update = { status: currentStatus };
    if (isGestorPleno) {
        update.text = currentTitle;
        update.data_inicio = currentDataInicio;
        update.data_fim = currentDataFim;
        update.prioridade = currentPrio;
        update.resps = currentResps;
        update.resp_emails = (currentResps || []).map(r => r.email).filter(Boolean);
    }

    let hasMeaningfulChange = false;
    let systemMsg = "";

    if (report) {
        update.historico = firebase.firestore.FieldValue.arrayUnion({ data: new Date().toLocaleString('pt-BR'), autor: currentUserEmail, texto: report });
        hasMeaningfulChange = true;
    } else if (update.status !== t.status) {
        systemMsg = `Atualizou Status Manual para: [${update.status.toUpperCase()}]`;
        update.historico = firebase.firestore.FieldValue.arrayUnion({ data: new Date().toLocaleString('pt-BR'), autor: "SISTEMA", texto: systemMsg });
        hasMeaningfulChange = true;
    }

    try {
        await db.collection('tarefas').doc(currentTaskId).update(update);

        if (hasMeaningfulChange) {
            let recipientsEmails = (update.resps || t.resps || []).map(r => r.email);
            const superAdmins = allUsers.filter(u => u.papel === 'super-admin').map(u => u.email);
            recipientsEmails = [...new Set([...recipientsEmails, ...superAdmins])];
            recipientsEmails = recipientsEmails.filter(email => email !== currentUserEmail);

            if (recipientsEmails.length > 0) {
                try {
                    const fn = functions.httpsCallable('sendNotification');
                    await fn({
                        destinatarios: recipientsEmails,
                        tipo: 'ATUALIZAÇÃO',
                        saudacao: '',
                        mensagem: `**${update.text || t.text}**\nProjeto: ${t.project}\n` +
                                  `Atualizado por: ${currentUserNome || currentUserEmail}\n` +
                                  `Novo status: ${update.status.toUpperCase()}\n\n` +
                                  (report ? `Reporte: ${report}` : systemMsg)
                    });
                } catch (e) { console.warn('Notificação não enviada:', e); }
            }
        }
        document.getElementById('newReport').value = "";
        closeModal();
        toast('Alterações salvas.', 'success');
    } catch (e) {
        console.error(e);
        toast('Falha ao salvar as alterações.', 'error');
    }
}

async function deleteTask() {
    const ok = await vetorConfirm('Excluir definitivamente esta demanda?', 'Excluir demanda');
    if (!ok) return;
    try {
        await db.collection('tarefas').doc(currentTaskId).delete();
        closeModal();
        toast('Demanda excluída.', 'success');
    } catch (e) {
        toast('Falha ao excluir.', 'error');
    }
}

// ==========================================================================
// 8. BUSINESS INTELLIGENCE
// ==========================================================================
function toggleFilterMenu(type) {
    document.querySelectorAll('.dropdown-content').forEach(el => { if (el.id !== `filter-checkboxes-${type}`) el.classList.remove('show'); });
    document.getElementById(`filter-checkboxes-${type}`).classList.toggle('show');
}

function updateBIAreaFilter() {
    const container = document.getElementById('filter-checkboxes-area');
    if (!container) return;
    const checkedBoxes = Array.from(document.querySelectorAll('.bi-area-check:checked')).map(cb => cb.value);

    const allowedTasks = getVisibleTasksBoard();
    const allAreas = [...new Set(allowedTasks.map(t => t.area || 'Sem Área'))].sort((a, b) => a.localeCompare(b));

    let html = `<label class="checkbox-item"><input type="checkbox" id="check-all-area" onchange="toggleAllAreas(this)" ${checkedBoxes.length === 0 || checkedBoxes.includes('ALL') ? 'checked' : ''}><strong>[ TODAS AS ÁREAS ]</strong></label>`;
    allAreas.forEach(a => {
        const isChecked = checkedBoxes.includes(a) || (checkedBoxes.length === 0 && document.getElementById('check-all-area')?.checked) ? 'checked' : '';
        html += `<label class="checkbox-item"><input type="checkbox" class="bi-area-check" value="${a}" onchange="updateBIProjectFilter()" ${isChecked}>${escapeHtml(a)}</label>`;
    });
    container.innerHTML = html;
    updateBIProjectFilter();
}

function toggleAllAreas(masterCheckbox) {
    document.querySelectorAll('.bi-area-check').forEach(cb => cb.checked = masterCheckbox.checked);
    biSelectedUsers = []; biSelectedStatuses = [];
    updateBIProjectFilter();
}

function updateBIProjectFilter() {
    const container = document.getElementById('filter-checkboxes-proj');
    if (!container) return;
    const masterAreaCheck = document.getElementById('check-all-area');
    const selectedAreas = Array.from(document.querySelectorAll('.bi-area-check:checked')).map(cb => cb.value);
    const btnAreaText = document.getElementById('btn-filter-area');

    let allowedTasks = getVisibleTasksBoard();

    if (masterAreaCheck && masterAreaCheck.checked) { btnAreaText.innerText = "[ TODAS AS ÁREAS ] ▾"; }
    else if (selectedAreas.length > 0) { btnAreaText.innerText = `${selectedAreas.length} ÁREA(S) ▾`; allowedTasks = allowedTasks.filter(t => selectedAreas.includes(t.area || 'Sem Área')); }
    else { btnAreaText.innerText = "NENHUMA ÁREA ▾"; allowedTasks = []; }

    const previouslyCheckedProjs = Array.from(document.querySelectorAll('.bi-proj-check:checked')).map(cb => cb.value);
    const allowedProjects = [...new Set(allowedTasks.map(t => t.project))].sort((a, b) => a.localeCompare(b));
    let html = `<label class="checkbox-item"><input type="checkbox" id="check-all-proj" onchange="toggleAllProjects(this)" ${previouslyCheckedProjs.length === 0 || previouslyCheckedProjs.includes('ALL') ? 'checked' : ''}><strong>[ TODOS PERMITIDOS ]</strong></label>`;
    allowedProjects.forEach(p => {
        const isChecked = previouslyCheckedProjs.includes(p) || (previouslyCheckedProjs.length === 0 && document.getElementById('check-all-proj')?.checked) ? 'checked' : '';
        html += `<label class="checkbox-item"><input type="checkbox" class="bi-proj-check" value="${p}" onchange="triggerRenderNativeBI()" ${isChecked}>${escapeHtml(p)}</label>`;
    });
    container.innerHTML = html;
    biSelectedUsers = []; biSelectedStatuses = [];
    renderNativeBI();
}

function toggleAllProjects(masterCheckbox) {
    document.querySelectorAll('.bi-proj-check').forEach(cb => cb.checked = masterCheckbox.checked);
    biSelectedUsers = []; biSelectedStatuses = [];
    renderNativeBI();
}

function triggerRenderNativeBI() { biSelectedUsers = []; biSelectedStatuses = []; renderNativeBI(); }

function renderNativeBI() {
    const masterCheck = document.getElementById('check-all-proj');
    const checkboxes = Array.from(document.querySelectorAll('.bi-proj-check:checked')).map(cb => cb.value);
    const btnText = document.getElementById('btn-filter-proj');
    const selectedAreas = Array.from(document.querySelectorAll('.bi-area-check:checked')).map(cb => cb.value);
    const masterAreaCheck = document.getElementById('check-all-area');

    let baseTasks = getVisibleTasksBoard();
    if (!(masterAreaCheck && masterAreaCheck.checked)) { baseTasks = baseTasks.filter(t => selectedAreas.includes(t.area || 'Sem Área')); }

    if (masterCheck && masterCheck.checked) { btnText.innerText = "[ TODOS OS PROJETOS ] ▾"; }
    else if (checkboxes.length > 0) { btnText.innerText = `${checkboxes.length} PROJETO(S) ▾`; baseTasks = baseTasks.filter(t => checkboxes.includes(t.project)); }
    else { btnText.innerText = "NENHUM PROJETO ▾"; baseTasks = []; }

    let totalMacroTasks = allTasks;
    if (!(masterAreaCheck && masterAreaCheck.checked)) { totalMacroTasks = totalMacroTasks.filter(t => selectedAreas.includes(t.area || 'Sem Área')); }
    if (checkboxes.length > 0 && !(masterCheck && masterCheck.checked)) { totalMacroTasks = totalMacroTasks.filter(t => checkboxes.includes(t.project)); }

    let teamTasks = baseTasks;
    if (biSelectedStatuses.length > 0) {
        teamTasks = baseTasks.filter(t => biSelectedStatuses.includes(getCalculatedStatus(t).id));
    }

    const teamLoad = {};
    teamTasks.forEach(t => {
        if (t.resps && t.resps.length > 0) { t.resps.forEach(r => { const rn = r.nome.split(' ')[0]; teamLoad[rn] = (teamLoad[rn] || 0) + 1; }); }
        else { teamLoad['Sem Dono'] = (teamLoad['Sem Dono'] || 0) + 1; }
    });

    const barLabels = Object.keys(teamLoad).sort((a, b) => a.localeCompare(b));
    const barData = barLabels.map(l => teamLoad[l]);
    const bgColors = barLabels.map(l => {
        if (biSelectedUsers.length === 0) return '#2563eb';
        return biSelectedUsers.includes(l) ? '#2563eb' : '#cbd5e1';
    });

    if (biChartTeam) biChartTeam.destroy();
    biChartTeam = new Chart(document.getElementById('biTeamChart'), {
        type: 'bar', data: { labels: barLabels, datasets: [{ label: 'Tarefas', data: barData, backgroundColor: bgColors, borderRadius: 4 }] },
        options: {
            responsive: true, maintainAspectRatio: false,
            onClick: (e, elements) => {
                if (elements.length > 0) {
                    const clickedUser = barLabels[elements[0].index];
                    if (biSelectedUsers.includes(clickedUser)) { biSelectedUsers = biSelectedUsers.filter(u => u !== clickedUser); }
                    else { biSelectedUsers.push(clickedUser); }
                    renderNativeBI();
                }
            }
        }
    });

    let pieTasks = baseTasks;
    if (biSelectedUsers.length > 0) {
        pieTasks = baseTasks.filter(t => {
            if (biSelectedUsers.includes('Sem Dono') && (!t.resps || t.resps.length === 0)) return true;
            if (!t.resps) return false;
            return t.resps.some(r => biSelectedUsers.includes(r.nome.split(' ')[0]));
        });
    }

    let pieKpis = { nao_iniciada: 0, atrasada: 0, execucao: 0, aguardando: 0, critica: 0, concluida: 0 };
    pieTasks.forEach(t => pieKpis[getCalculatedStatus(t).id]++);

    const pieLabels = ['Não Iniciadas', 'Atraso p/ Início', 'Em Execução', 'Aguardando OK', 'Críticas', 'Concluídas'];
    const pieData = [pieKpis.nao_iniciada, pieKpis.atrasada, pieKpis.execucao, pieKpis.aguardando, pieKpis.critica, pieKpis.concluida];
    const pieColorsBase = ['#94a3b8', '#f59e0b', '#3b82f6', '#10b981', '#dc3545', '#059669'];
    const pieIds = ['nao_iniciada', 'atrasada', 'execucao', 'aguardando', 'critica', 'concluida'];

    const pieColorsFinal = pieColorsBase.map((c, i) => {
        if (biSelectedStatuses.length === 0) return c;
        return biSelectedStatuses.includes(pieIds[i]) ? c : '#e2e8f0';
    });

    if (biChartProgress) biChartProgress.destroy();
    biChartProgress = new Chart(document.getElementById('biProgressChart'), {
        type: 'doughnut', data: { labels: pieLabels, datasets: [{ data: pieData, backgroundColor: pieColorsFinal }] },
        options: {
            responsive: true, maintainAspectRatio: false, cutout: '50%',
            plugins: { tooltip: { callbacks: { label: function(c) { let v = c.parsed, t = c.dataset.data.reduce((a, b) => a + b, 0), p = t > 0 ? Math.round((v / t) * 100) : 0; return ` ${c.label}: ${v} (${p}%)`; } } } },
            onClick: (e, elements) => {
                if (elements.length > 0) {
                    const clickedStatus = pieIds[elements[0].index];
                    if (biSelectedStatuses.includes(clickedStatus)) { biSelectedStatuses = biSelectedStatuses.filter(s => s !== clickedStatus); }
                    else { biSelectedStatuses.push(clickedStatus); }
                    renderNativeBI();
                }
            }
        }
    });

    currentFilteredTasks = baseTasks;
    if (biSelectedUsers.length > 0) {
        currentFilteredTasks = currentFilteredTasks.filter(t => {
            if (biSelectedUsers.includes('Sem Dono') && (!t.resps || t.resps.length === 0)) return true;
            if (!t.resps) return false;
            return t.resps.some(r => biSelectedUsers.includes(r.nome.split(' ')[0]));
        });
    }
    if (biSelectedStatuses.length > 0) {
        currentFilteredTasks = currentFilteredTasks.filter(t => biSelectedStatuses.includes(getCalculatedStatus(t).id));
    }

    let kpis = { total: currentFilteredTasks.length, nao_iniciada: 0, atrasada: 0, execucao: 0, aguardando: 0, critica: 0, concluidas: 0 };
    currentFilteredTasks.forEach(t => {
        const cStatus = getCalculatedStatus(t);
        if (cStatus.id === 'nao_iniciada') kpis.nao_iniciada++;
        if (cStatus.id === 'atrasada') kpis.atrasada++;
        if (cStatus.id === 'execucao') kpis.execucao++;
        if (cStatus.id === 'aguardando') kpis.aguardando++;
        if (cStatus.id === 'critica') kpis.critica++;
        if (cStatus.id === 'concluida') kpis.concluidas++;
    });

    document.getElementById('bi-kpi-total').innerText = kpis.total;
    document.getElementById('bi-kpi-nao-iniciada').innerText = kpis.nao_iniciada;
    document.getElementById('bi-kpi-atrasada').innerText = kpis.atrasada;
    document.getElementById('bi-kpi-execucao').innerText = kpis.execucao;
    document.getElementById('bi-kpi-aguardando').innerText = kpis.aguardando;
    document.getElementById('bi-kpi-critica').innerText = kpis.critica;

    let influencePerc = 100;
    if (totalMacroTasks.length > 0) {
        influencePerc = Math.round((currentFilteredTasks.length / totalMacroTasks.length) * 100);
    } else { influencePerc = 0; }
    document.getElementById('bi-kpi-influencia').innerText = influencePerc + '%';

    drawExecutiveGantt(currentFilteredTasks);
}

function drawExecutiveGantt(tasks) {
    const tbody = document.getElementById('bi-gantt-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    const gTasks = tasks.filter(t => t.data_inicio && t.data_fim);
    if (gTasks.length === 0) { tbody.innerHTML = '<tr><td colspan="2" style="text-align:center; color:#888;">Nenhum cronograma definido.</td></tr>'; return; }

    const today = new Date(); today.setHours(0,0,0,0);
    const timeToday = today.getTime();

    const timesInicio = gTasks.map(t => new Date(t.data_inicio + 'T00:00:00').getTime());
    const timesFim = gTasks.map(t => new Date(t.data_fim + 'T00:00:00').getTime());

    let minTime = Math.min(timeToday, ...timesInicio);
    let maxTime = Math.max(timeToday, ...timesFim);

    let minDate = new Date(minTime); let maxDate = new Date(maxTime);
    minDate.setDate(minDate.getDate() - 1); maxDate.setDate(maxDate.getDate() + 1);

    const totalDuration = Math.max(maxDate - minDate, 86400000);
    const todayPerc = ((timeToday - minDate) / totalDuration) * 100;
    let todayMarker = (todayPerc >= 0 && todayPerc <= 100) ? `<div class="gantt-today-marker" style="left: ${todayPerc}%;" title="Hoje"></div>` : '';

    let html = '';
    gTasks.forEach(t => {
        const start = new Date(t.data_inicio + 'T00:00:00');
        const end = new Date(t.data_fim + 'T00:00:00');
        const leftPerc = ((start - minDate) / totalDuration) * 100;
        const widthPerc = Math.max(((end - start) / totalDuration) * 100, 2);

        const cStatus = getCalculatedStatus(t);
        const respNames = t.resps && t.resps.length > 0 ? t.resps.map(r => r.nome.split(' ')[0]).join(', ') : '-';
        const fStart = start.toLocaleDateString('pt-BR');
        const fEnd = end.toLocaleDateString('pt-BR');

        html += `<tr><td><strong style="font-size: 13px;">${escapeHtml(t.text)}</strong><br><small style="color:#64748b;">[${escapeHtml(t.project)}] • Resp: ${escapeHtml(respNames)}</small></td>
        <td><div class="gantt-track">${todayMarker}<div class="gantt-bar-fill ${cStatus.class}" style="left: ${leftPerc}%; width: ${widthPerc}%;" title="Início: ${fStart}\nTérmino: ${fEnd}\nStatus: ${cStatus.label}"><span>📅 ${start.toLocaleDateString('pt-BR', {day:'2-digit',month:'2-digit'})} até ${end.toLocaleDateString('pt-BR', {day:'2-digit',month:'2-digit'})}</span></div></div></td></tr>`;
    });
    tbody.innerHTML = html;
}

function openDrilldown(type) {
    const modal = document.getElementById('drilldownModal');
    const tbody = document.getElementById('drilldownBody');
    const title = document.getElementById('drilldownTitle');
    let targetTasks = [];

    if (type === 'total') { title.innerText = "Detalhamento: Total de Demandas"; targetTasks = currentFilteredTasks; }
    else {
        const categoryMap = {
            'nao_iniciada': 'Demandas Não Iniciadas',
            'atrasada': 'Atrasadas para Iniciar',
            'execucao': 'Demandas em Execução',
            'aguardando': 'Aguardando Validação do Gestor',
            'critica': 'Demandas Críticas (Prazo Vencido)'
        };
        title.innerText = `Detalhamento: ${categoryMap[type]}`;
        targetTasks = currentFilteredTasks.filter(t => getCalculatedStatus(t).id === type);
    }

    if (targetTasks.length === 0) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Nenhuma tarefa encontrada.</td></tr>'; }
    else {
        tbody.innerHTML = targetTasks.map(t => {
            const respNames = t.resps && t.resps.length > 0 ? t.resps.map(r => r.nome.split(' ')[0]).join(', ') : '-';
            const cStatus = getCalculatedStatus(t);
            return `<tr onclick="abrirModal('${t.id}')" style="cursor:pointer" title="Abrir demanda">
                <td style="font-size:11px; color:#666;">${escapeHtml(t.area || '-')}</td>
                <td class="bold">${escapeHtml(t.project)}</td>
                <td>${escapeHtml(t.text)}</td>
                <td>${t.data_fim ? t.data_fim.split('-').reverse().join('/') : 'N/D'}</td>
                <td>${escapeHtml(respNames)}</td>
                <td><span class="status-pill ${cStatus.class}">${cStatus.label}</span></td>
            </tr>`;
        }).join('');
    }
    modal.classList.add('active');
}

function closeDrilldown() { document.getElementById('drilldownModal').classList.remove('active'); }

// ==========================================================================
// 9. KANBAN COM DRAG-AND-DROP
// ==========================================================================
const KANBAN_COLS = [
    { id: 'nao_iniciada', label: 'Não Iniciadas', color: '#94a3b8', maps: { fazer: true } },
    { id: 'execucao', label: 'Em Execução', color: '#3b82f6', maps: { andamento: true } },
    { id: 'aguardando', label: 'Aguardando OK', color: '#10b981', maps: { aprovacao: true } },
    { id: 'critica', label: 'Críticas', color: '#dc3545', maps: {} }, // só read-only (status calculado)
    { id: 'concluida', label: 'Concluídas', color: '#059669', maps: { concluido: true } }
];

function renderKanban() {
    const board = document.getElementById('kanbanBoard');
    if (!board) return;

    const ka = document.getElementById('kanbanAreaFilter')?.value || 'geral';
    const kp = document.getElementById('kanbanProjectFilter')?.value || 'geral';

    let tasks = getVisibleTasksBoard();
    if (ka !== 'geral') tasks = tasks.filter(t => (t.area || 'Sem Área') === ka);
    if (kp !== 'geral') tasks = tasks.filter(t => t.project === kp);

    let html = '';
    KANBAN_COLS.forEach(col => {
        const colTasks = tasks.filter(t => getCalculatedStatus(t).id === col.id || (col.id === 'atrasada' && getCalculatedStatus(t).id === 'atrasada'));
        html += `<div class="kanban-col" data-status="${col.id}" ondragover="kanbanDragOver(event)" ondragleave="kanbanDragLeave(event)" ondrop="kanbanDrop(event)">
            <div class="kanban-col-header" style="border-bottom-color: ${col.color};">
                <h4 style="color: ${col.color};">${col.label}</h4>
                <span class="kanban-col-count">${colTasks.length}</span>
            </div>
            <div class="kanban-col-list">`;
        if (colTasks.length === 0) {
            html += `<div class="kanban-col-empty">Sem tarefas</div>`;
        } else {
            colTasks.forEach(t => {
                const respNomes = t.resps && t.resps.length > 0 ? t.resps.map(r => r.nome.split(' ')[0]).join(', ') : '—';
                const prio = t.prioridade || 'media';
                const prioColor = getPriorityColor(prio);
                const prazo = t.data_fim ? t.data_fim.split('-').reverse().join('/') : '—';
                html += `<div class="kanban-card" draggable="true" data-task-id="${t.id}" ondragstart="kanbanDragStart(event)" ondragend="kanbanDragEnd(event)" onclick="abrirModal('${t.id}')" style="border-left-color: ${prioColor};">
                    <div class="kanban-card-title">${escapeHtml(t.text)}</div>
                    <div class="kanban-card-meta">
                        <span><span class="kanban-card-prio" style="background:${prioColor};"></span>${prio}</span>
                        <span>📁 ${escapeHtml(t.project)}</span>
                        <span>📅 ${prazo}</span>
                        <span>👤 ${escapeHtml(respNomes)}</span>
                    </div>
                </div>`;
            });
        }
        html += `</div></div>`;
    });
    board.innerHTML = html;
}

let kanbanDraggedId = null;
function kanbanDragStart(e) {
    kanbanDraggedId = e.target.dataset.taskId;
    e.target.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
}
function kanbanDragEnd(e) {
    e.target.classList.remove('dragging');
    document.querySelectorAll('.kanban-col.drag-over').forEach(c => c.classList.remove('drag-over'));
}
function kanbanDragOver(e) {
    e.preventDefault();
    e.currentTarget.classList.add('drag-over');
}
function kanbanDragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
}
async function kanbanDrop(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    if (!kanbanDraggedId) return;
    const newStatusId = e.currentTarget.dataset.status;
    const t = allTasks.find(x => x.id === kanbanDraggedId);
    if (!t) return;

    // Mapear de status calculado para status real
    let newRealStatus = null;
    if (newStatusId === 'nao_iniciada') newRealStatus = 'fazer';
    else if (newStatusId === 'execucao') newRealStatus = 'andamento';
    else if (newStatusId === 'aguardando') newRealStatus = 'aprovacao';
    else if (newStatusId === 'concluida') newRealStatus = 'concluido';
    else if (newStatusId === 'critica') {
        toast('"Crítica" é um status calculado a partir do prazo. Para resolver, edite o prazo na demanda.', 'warning', 5000);
        kanbanDraggedId = null;
        return;
    }

    // Permissão para concluir
    const isGestorPleno = currentUserRole === 'super-admin' || managedAreas.includes(t.area) || managedProjects.includes(t.project);
    if (newRealStatus === 'concluido' && !isGestorPleno) {
        toast('Apenas gestores podem mover para Concluída.', 'error');
        kanbanDraggedId = null;
        return;
    }

    if (t.status === newRealStatus) { kanbanDraggedId = null; return; }

    try {
        await db.collection('tarefas').doc(kanbanDraggedId).update({
            status: newRealStatus,
            historico: firebase.firestore.FieldValue.arrayUnion({
                data: new Date().toLocaleString('pt-BR'),
                autor: 'SISTEMA',
                texto: `Status atualizado via Kanban para [${newRealStatus.toUpperCase()}]`
            })
        });
        toast('Status atualizado.', 'success');
    } catch (err) {
        console.error(err);
        toast('Falha ao atualizar status.', 'error');
    }
    kanbanDraggedId = null;
}

// ==========================================================================
// 10. BUSCA GLOBAL
// ==========================================================================
function executarBusca() {
    const termo = (document.getElementById('buscaInput')?.value || '').trim().toLowerCase();
    const statusOk = Array.from(document.querySelectorAll('.busca-status-filter:checked')).map(cb => cb.value);
    const cont = document.getElementById('buscaResultados');
    if (!cont) return;

    if (!termo) {
        cont.innerHTML = '<div class="busca-empty">Digite algo para buscar entre suas tarefas.</div>';
        return;
    }

    let tasks = getVisibleTasksBoard();
    tasks = tasks.filter(t => statusOk.includes(getCalculatedStatus(t).id));

    const matches = tasks.filter(t => {
        const haystack = [
            t.text, t.descricao, t.project, t.area,
            (t.resps || []).map(r => r.nome).join(' '),
            (t.resps || []).map(r => r.email).join(' '),
            (t.historico || []).map(h => h.texto).join(' ')
        ].join(' ').toLowerCase();
        return haystack.includes(termo);
    });

    if (matches.length === 0) {
        cont.innerHTML = '<div class="busca-empty">Nada encontrado para esse termo.</div>';
        return;
    }

    cont.innerHTML = matches.map(t => {
        const cs = getCalculatedStatus(t);
        const respNomes = t.resps && t.resps.length > 0 ? t.resps.map(r => r.nome.split(' ')[0]).join(', ') : '—';
        const prazo = t.data_fim ? t.data_fim.split('-').reverse().join('/') : '—';
        return `<div class="busca-item" onclick="abrirModal('${t.id}')">
            <div class="busca-item-title">${escapeHtml(t.text)}</div>
            <div class="busca-item-meta">
                <span class="status-pill ${cs.class}">${cs.label}</span>
                <span>📁 ${escapeHtml(t.project)}</span>
                <span>🏷️ ${escapeHtml(t.area || '—')}</span>
                <span>📅 ${prazo}</span>
                <span>👤 ${escapeHtml(respNomes)}</span>
            </div>
        </div>`;
    }).join('');
}

// ==========================================================================
// 11. EXPORTAÇÃO CSV
// ==========================================================================
function tasksToCSV(tasks) {
    const headers = ['ID', 'Area', 'Projeto', 'Tarefa', 'Status Calculado', 'Inicio', 'Prazo', 'Prioridade', 'Responsaveis'];
    const rows = tasks.map(t => {
        const cs = getCalculatedStatus(t);
        const resp = (t.resps || []).map(r => r.nome).join(' | ');
        return [t.id, t.area || '', t.project, t.text, cs.label, t.data_inicio || '', t.data_fim || '', t.prioridade || 'media', resp];
    });
    return [headers, ...rows].map(r => r.map(c => `"${String(c || '').replace(/"/g, '""')}"`).join(',')).join('\n');
}

function downloadCSV(content, filename) {
    const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link); link.click(); link.remove();
}

function exportarBI() {
    const csv = tasksToCSV(currentFilteredTasks);
    downloadCSV(csv, `vetor-bi-${new Date().toISOString().slice(0,10)}.csv`);
    toast(`${currentFilteredTasks.length} tarefa(s) exportada(s).`, 'success');
}
function exportarOperacional() {
    const t = getFilteredOperationalTasks();
    const csv = tasksToCSV(t);
    downloadCSV(csv, `vetor-operacional-${new Date().toISOString().slice(0,10)}.csv`);
    toast(`${t.length} tarefa(s) exportada(s).`, 'success');
}

// ==========================================================================
// 12. CADASTRO POR VOZ (Web Speech API)
// ==========================================================================
function abrirCadastroVoz() {
    document.getElementById('vozModal').classList.add('active');
    document.getElementById('vozTranscricao').value = '';
    document.getElementById('vozPreview').style.display = 'none';
    document.getElementById('vozPreview').innerHTML = '';
    document.getElementById('vozAnalisarBtn').style.display = 'inline-block';
    document.getElementById('vozConfirmarBtn').style.display = 'none';
    document.getElementById('vozStatus').innerText = 'Toque no microfone para começar.';
    vozParsedDemand = null;
}
function fecharCadastroVoz() {
    if (vozIsRecording && vozRecognition) try { vozRecognition.stop(); } catch(e){}
    document.getElementById('vozModal').classList.remove('active');
    document.getElementById('vozMicBtn').classList.remove('gravando');
    vozIsRecording = false;
}

function alternarGravacao() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
        toast('Seu navegador não suporta reconhecimento de voz. Use Chrome ou Edge.', 'error', 5000);
        return;
    }
    if (vozIsRecording && vozRecognition) {
        try { vozRecognition.stop(); } catch(e){}
        return;
    }
    vozRecognition = new SR();
    vozRecognition.lang = 'pt-BR';
    vozRecognition.continuous = true;
    vozRecognition.interimResults = true;
    let textoFinal = document.getElementById('vozTranscricao').value || '';

    vozRecognition.onstart = () => {
        vozIsRecording = true;
        document.getElementById('vozMicBtn').classList.add('gravando');
        document.getElementById('vozStatus').innerText = 'Gravando... toque novamente para parar.';
    };
    vozRecognition.onresult = (ev) => {
        let interim = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
            const r = ev.results[i];
            if (r.isFinal) textoFinal += r[0].transcript + ' ';
            else interim += r[0].transcript;
        }
        document.getElementById('vozTranscricao').value = (textoFinal + interim).trim();
    };
    vozRecognition.onend = () => {
        vozIsRecording = false;
        document.getElementById('vozMicBtn').classList.remove('gravando');
        document.getElementById('vozStatus').innerText = 'Pronto. Confira o texto e analise com o Vetor IA.';
    };
    vozRecognition.onerror = (ev) => {
        console.error('voz erro:', ev);
        toast('Erro no reconhecimento de voz: ' + ev.error, 'error');
        vozIsRecording = false;
        document.getElementById('vozMicBtn').classList.remove('gravando');
    };
    try { vozRecognition.start(); } catch(e){ console.error(e); }
}

async function analisarTranscricaoIA() {
    const texto = document.getElementById('vozTranscricao').value.trim();
    if (!texto) return toast('Grave ou digite o que deseja cadastrar.', 'warning');

    document.getElementById('vozStatus').innerText = 'Vetor IA analisando...';
    document.getElementById('vozAnalisarBtn').disabled = true;

    try {
        const fn = functions.httpsCallable('aiParseDemand');
        const ctx = {
            areas: allAreasData.map(a => a.id),
            projetos: [...new Set(allTasks.map(t => t.project))],
            usuarios: allUsers.map(u => ({ nome: u.nome, email: u.email })),
            currentUserEmail
        };
        const res = await fn({ texto, contexto: ctx });
        const parsed = res.data;
        vozParsedDemand = parsed;
        renderVozPreview(parsed);
        document.getElementById('vozAnalisarBtn').style.display = 'none';
        document.getElementById('vozConfirmarBtn').style.display = 'inline-block';
        document.getElementById('vozStatus').innerText = 'Confira a estruturação. Edite os campos do JSON se precisar.';
    } catch (e) {
        console.error('aiParseDemand falhou:', e);
        toast('Vetor IA ainda não está pronto neste deploy. Faça o deploy das Cloud Functions.', 'error', 5000);
    } finally {
        document.getElementById('vozAnalisarBtn').disabled = false;
    }
}

function renderVozPreview(p) {
    const box = document.getElementById('vozPreview');
    box.style.display = 'block';
    box.innerHTML = `
        <h5>Vetor IA estruturou a demanda assim:</h5>
        <div class="voz-preview-row"><strong>Área</strong><span>${escapeHtml(p.area || '—')}</span></div>
        <div class="voz-preview-row"><strong>Projeto</strong><span>${escapeHtml(p.projeto || '—')}</span></div>
        <div class="voz-preview-row"><strong>Título</strong><span>${escapeHtml(p.titulo || '—')}</span></div>
        <div class="voz-preview-row"><strong>Escopo</strong><span>${escapeHtml(p.escopo || '—')}</span></div>
        <div class="voz-preview-row"><strong>Início</strong><span>${escapeHtml(p.data_inicio || '—')}</span></div>
        <div class="voz-preview-row"><strong>Prazo</strong><span>${escapeHtml(p.data_fim || '—')}</span></div>
        <div class="voz-preview-row"><strong>Prioridade</strong><span>${escapeHtml(p.prioridade || 'media')}</span></div>
        <div class="voz-preview-row"><strong>Responsáveis</strong><span>${(p.responsaveis || []).map(r => `${r.nome} (${r.papel})`).join(', ') || '—'}</span></div>
    `;
}

async function confirmarCadastroVoz() {
    if (!vozParsedDemand) return;
    const p = vozParsedDemand;
    if (!p.area || !p.projeto || !p.titulo || !p.data_inicio || !p.data_fim || !p.responsaveis || p.responsaveis.length === 0) {
        return toast('Faltam campos. Refine a transcrição e analise novamente.', 'warning');
    }
    try {
        const batch = db.batch();
        const destinatarios = [];
        for (const r of p.responsaveis) {
            const u = allUsers.find(x => x.email === r.email);
            if (!u) { toast(`Usuário ${r.email} não encontrado.`, 'warning'); continue; }
            const ref = db.collection('tarefas').doc();
            batch.set(ref, {
                area: p.area, project: p.projeto, text: p.titulo, descricao: p.escopo || '',
                data_inicio: p.data_inicio, data_fim: p.data_fim,
                status: 'fazer', prioridade: p.prioridade || 'media',
                resps: [{ nome: u.nome, email: u.email, papel: r.papel || 'executor' }],
                resp_emails: [u.email],
                criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
                historico: [{ data: new Date().toLocaleString('pt-BR'), autor: 'SISTEMA', texto: 'Cadastrada via voz + Vetor IA.' }],
                email: u.email, criadoPor: currentUserEmail
            });
            destinatarios.push(u.email);
        }
        await batch.commit();

        // Notificação multi-canal (e-mail + WhatsApp se cadastrado)
        if (destinatarios.length > 0) {
            try {
                const fn = functions.httpsCallable('sendNotification');
                await fn({
                    destinatarios,
                    tipo: 'NOVA DEMANDA',
                    saudacao: '',
                    mensagem: `Você foi atribuído a uma nova demanda no Vetor (cadastrada por voz):\n\n` +
                              `**${p.titulo}**\nProjeto: ${p.projeto}\nÁrea: ${p.area}\n` +
                              `Início: ${p.data_inicio} | Prazo: ${p.data_fim}\n\n` +
                              (p.escopo ? `Escopo: ${p.escopo}\n\n` : '') +
                              `Acesse o Vetor para ver os detalhes.`
                });
            } catch (e) { console.warn('Notificação não enviada:', e); }
        }

        toast('Demanda cadastrada por voz.', 'success');
        fecharCadastroVoz();
    } catch (e) {
        console.error(e);
        toast('Falha ao cadastrar.', 'error');
    }
}

// ==========================================================================
// 13. VETOR IA — DRAWER E CHAT
// ==========================================================================
function toggleVetorIA() {
    const drawer = document.getElementById('vetorIADrawer');
    const backdrop = document.getElementById('vetorIABackdrop');
    const isOpen = drawer.classList.contains('open');
    if (isOpen) {
        drawer.classList.remove('open');
        backdrop.classList.remove('open');
    } else {
        drawer.classList.add('open');
        backdrop.classList.add('open');
        if (iaConversation.length === 0) {
            iaAddBotMsg('Olá. Sou o **Vetor IA**, seu assistente executivo. Posso fazer um briefing do dia, sinalizar quem está sobrecarregado, redigir cobranças, ou cadastrar demandas em linguagem natural. O que precisa agora?');
        }
        document.getElementById('iaInput').focus();
    }
}

function iaAddUserMsg(t) {
    const c = document.getElementById('iaConversa');
    const div = document.createElement('div');
    div.className = 'ia-msg ia-msg-user';
    div.innerText = t;
    c.appendChild(div); c.scrollTop = c.scrollHeight;
    iaConversation.push({ role: 'user', content: t });
}
function iaAddBotMsg(t, isAction = false) {
    const c = document.getElementById('iaConversa');
    const div = document.createElement('div');
    div.className = 'ia-msg ia-msg-bot' + (isAction ? ' ia-msg-action' : '');
    div.innerHTML = '<strong>VETOR IA</strong>' + iaFormat(t);
    c.appendChild(div); c.scrollTop = c.scrollHeight;
    iaConversation.push({ role: 'assistant', content: t });
}
function iaAddLoadingMsg() {
    const c = document.getElementById('iaConversa');
    const div = document.createElement('div');
    div.className = 'ia-msg ia-msg-bot ia-msg-loading';
    div.id = 'ia-loading';
    div.innerText = 'Pensando...';
    c.appendChild(div); c.scrollTop = c.scrollHeight;
}
function iaRemoveLoading() {
    const el = document.getElementById('ia-loading');
    if (el) el.remove();
}
function iaFormat(t) {
    // Bold simples **texto**
    return escapeHtml(t).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
}

async function iaEnviar() {
    const input = document.getElementById('iaInput');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    iaAddUserMsg(text);
    iaAddLoadingMsg();
    document.getElementById('iaEnviarBtn').disabled = true;

    try {
        const fn = functions.httpsCallable('aiAssistant');
        const contexto = construirContextoIA();
        const res = await fn({ messages: iaConversation, contexto });
        iaRemoveLoading();
        const data = res.data;

        // Suporte a ações estruturadas: { resposta, acoes: [{tipo, payload}] }
        if (data.acoes && data.acoes.length > 0) {
            await executarAcoesIA(data.acoes);
        }
        iaAddBotMsg(data.resposta || 'Pronto.', !!data.acoes);
    } catch (e) {
        console.error('aiAssistant falhou:', e);
        iaRemoveLoading();
        iaAddBotMsg('Não consegui processar agora. As Cloud Functions de IA precisam estar deployadas. Veja o README de deploy na raiz do projeto.');
    } finally {
        document.getElementById('iaEnviarBtn').disabled = false;
    }
}

function construirContextoIA() {
    // Tarefas ativas: visão padrão (sem arquivadas)
    const tasksVis = getVisibleTasksBoard();
    // Arquivadas vão num campo separado para o Claude saber distinguir.
    const arquivadas = getArchivedTasks();
    const mapTask = t => ({
        id: t.id, area: t.area, projeto: t.project, titulo: t.text,
        status: t.status, statusCalc: getCalculatedStatus(t).id,
        prioridade: t.prioridade || 'media',
        data_inicio: t.data_inicio, data_fim: t.data_fim,
        arquivada: !!t.arquivada,
        responsaveis: (t.resps || []).map(r => ({ nome: r.nome, email: r.email, papel: r.papel }))
    });
    return {
        currentUserEmail,
        currentUserNome,
        currentUserRole,
        areas: allAreasData.map(a => ({ id: a.id, gestores: a.gestores })),
        usuarios: allUsers.map(u => ({ nome: u.nome, email: u.email, papel: u.papel })),
        tarefas: tasksVis.map(mapTask),
        tarefas_arquivadas: arquivadas.map(mapTask) // Claude pode citar quando perguntado sobre histórico
    };
}

async function executarAcoesIA(acoes) {
    for (const a of acoes) {
        try {
            if (a.tipo === 'criar_demanda') {
                const p = a.payload;
                const u = allUsers.find(x => x.email === (p.responsaveis?.[0]?.email));
                if (!u) { toast(`Não encontrei o usuário ${p.responsaveis?.[0]?.email}`, 'warning'); continue; }
                await db.collection('tarefas').add({
                    area: p.area, project: p.projeto, text: p.titulo, descricao: p.escopo || '',
                    data_inicio: p.data_inicio, data_fim: p.data_fim,
                    status: 'fazer', prioridade: p.prioridade || 'media',
                    resps: [{ nome: u.nome, email: u.email, papel: p.responsaveis[0].papel || 'executor' }],
                    resp_emails: [u.email],
                    criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
                    historico: [{ data: new Date().toLocaleString('pt-BR'), autor: 'SISTEMA', texto: 'Cadastrada via Vetor IA.' }],
                    email: u.email, criadoPor: currentUserEmail
                });
                // Notificação multi-canal
                try {
                    const fn = functions.httpsCallable('sendNotification');
                    await fn({
                        destinatarios: [u.email],
                        tipo: 'NOVA DEMANDA',
                        saudacao: '',
                        mensagem: `Você foi atribuído a uma nova demanda no Vetor (criada via assistente de IA):\n\n` +
                                  `**${p.titulo}**\nProjeto: ${p.projeto}\nÁrea: ${p.area}\n` +
                                  `Início: ${p.data_inicio} | Prazo: ${p.data_fim}\n\n` +
                                  `Acesse o Vetor para ver os detalhes.`
                    });
                } catch (notifErr) { console.warn('Notificação não enviada:', notifErr); }
                toast('Demanda criada via Vetor IA.', 'success');
            } else if (a.tipo === 'enviar_cobranca') {
                // Disparar Cloud Function para envio personalizado por IA
                const fn = functions.httpsCallable('sendSmartReminder');
                await fn({ taskId: a.payload.taskId, tom: a.payload.tom || 'gentil' });
                toast('Cobrança enviada.', 'success');
            } else if (a.tipo === 'atualizar_status') {
                await db.collection('tarefas').doc(a.payload.taskId).update({
                    status: a.payload.novoStatus,
                    historico: firebase.firestore.FieldValue.arrayUnion({
                        data: new Date().toLocaleString('pt-BR'), autor: 'SISTEMA',
                        texto: `Status alterado via Vetor IA para [${a.payload.novoStatus.toUpperCase()}]`
                    })
                });
            }
        } catch (e) {
            console.error('Falha em ação IA:', a, e);
            toast('Falha ao executar uma ação sugerida pela IA.', 'error');
        }
    }
}

// Atalhos de quick-action
function iaPedirBriefing() {
    document.getElementById('iaInput').value = 'Faça um briefing executivo do dia, com os 3 pontos de atenção principais.';
    iaEnviar();
}
function iaListarSobrecarregados() {
    document.getElementById('iaInput').value = 'Quem está sobrecarregado nesta semana? Considere número de tarefas em execução e atrasadas por pessoa.';
    iaEnviar();
}
function iaCobrancasPendentes() {
    document.getElementById('iaInput').value = 'Liste as cobranças que precisam ser feitas hoje (tarefas atrasadas) e sugira o tom apropriado para cada uma.';
    iaEnviar();
}

// Análise IA dentro do modal de tarefa
async function solicitarAnaliseIA() {
    const t = allTasks.find(x => x.id === currentTaskId);
    if (!t) return;
    const box = document.getElementById('ai-analise-box');
    box.style.display = 'block';
    box.innerHTML = '<em style="color:#64748b;">Vetor IA analisando esta demanda...</em>';

    try {
        const fn = functions.httpsCallable('aiAnalyseTask');
        const ctx = construirContextoIA();
        const res = await fn({ taskId: t.id, contexto: ctx });
        const data = res.data;
        box.innerHTML = `<div style="background:#eef2ff; border:1px solid #c7d2fe; padding:12px; border-radius:6px;">
            <strong style="color:#3730a3; font-size:11px; letter-spacing:0.5px;">DIAGNÓSTICO VETOR IA</strong>
            <div style="margin-top:8px; font-size:13px; line-height:1.55; white-space:pre-wrap;">${escapeHtml(data.analise)}</div>
        </div>`;
    } catch (e) {
        console.error(e);
        box.innerHTML = '<em style="color:#dc3545;">IA indisponível. Faça o deploy das Cloud Functions.</em>';
    }
}

async function cobrarComIA() {
    const t = allTasks.find(x => x.id === currentTaskId);
    if (!t) return;
    const ok = await vetorConfirm('Vetor IA vai redigir e enviar uma cobrança personalizada para os responsáveis. Confirma?', 'Cobrar com IA');
    if (!ok) return;
    try {
        const fn = functions.httpsCallable('sendSmartReminder');
        await fn({ taskId: t.id, tom: 'gentil' });
        toast('Cobrança enviada.', 'success');
    } catch (e) {
        toast('Falha ao enviar cobrança.', 'error');
    }
}

// ==========================================================================
// 14. ARQUIVAMENTO — manual e auto (fallback client-side)
// ==========================================================================
const AUTO_ARCHIVE_DAYS = 30;

// Arquiva ou desarquiva um projeto inteiro (em lote).
async function arquivarProjetoCascata(arquivar) {
    const projName = document.getElementById('adminEditProjTarget').innerText;
    if (!projName) return;

    const acao = arquivar ? 'arquivar' : 'desarquivar';
    const ok = await vetorConfirm(
        `Você vai ${acao} TODAS as tarefas do projeto "${projName}". Confirma?`,
        `${acao.charAt(0).toUpperCase() + acao.slice(1)} projeto`
    );
    if (!ok) return;

    try {
        const batch = db.batch();
        const snapshot = await db.collection('tarefas').where('project', '==', projName).get();
        if (snapshot.empty) { toast('Nenhuma tarefa encontrada.', 'warning'); return; }
        snapshot.forEach(doc => {
            batch.update(doc.ref, {
                arquivada: arquivar,
                arquivada_em: arquivar ? firebase.firestore.FieldValue.serverTimestamp() : firebase.firestore.FieldValue.delete()
            });
        });
        await batch.commit();
        toast(`Projeto ${acao}do em ${snapshot.size} tarefa(s).`, 'success');
        cancelarEdicaoProjetoAdmin();
        renderAdminPanel();
    } catch (e) {
        console.error(e);
        toast(`Falha ao ${acao} projeto.`, 'error');
    }
}

// Arquiva uma tarefa individual.
async function arquivarTarefa(taskId, arquivar) {
    try {
        await db.collection('tarefas').doc(taskId).update({
            arquivada: arquivar,
            arquivada_em: arquivar ? firebase.firestore.FieldValue.serverTimestamp() : firebase.firestore.FieldValue.delete()
        });
        toast(arquivar ? 'Tarefa arquivada.' : 'Tarefa desarquivada.', 'success');
    } catch (e) {
        toast('Falha ao alterar arquivamento.', 'error');
    }
}

// Render da aba Arquivo: agrupa por projeto.
function renderArquivo() {
    const cont = document.getElementById('arquivoLista');
    if (!cont) return;
    const arquivadas = getArchivedTasks();

    if (arquivadas.length === 0) {
        cont.innerHTML = '<div class="arquivo-empty">Nenhuma tarefa arquivada. Tarefas concluídas há mais de 30 dias chegam aqui automaticamente.</div>';
        return;
    }

    const grouped = {};
    arquivadas.forEach(t => {
        const k = t.project || 'Sem Projeto';
        if (!grouped[k]) grouped[k] = [];
        grouped[k].push(t);
    });

    let html = '';
    Object.keys(grouped).sort((a, b) => a.localeCompare(b)).forEach(projName => {
        const tasks = grouped[projName];
        const area = tasks[0].area || 'Sem Área';
        html += `<div class="arquivo-projeto">
            <div class="arquivo-projeto-header">
                <h4>📦 ${escapeHtml(projName)} <small>(${escapeHtml(area)} · ${tasks.length} tarefa${tasks.length > 1 ? 's' : ''})</small></h4>
            </div>`;
        tasks.forEach(t => {
            const respNomes = t.resps && t.resps.length > 0 ? t.resps.map(r => r.nome.split(' ')[0]).join(', ') : '—';
            const dataConclusao = t.data_fim ? t.data_fim.split('-').reverse().join('/') : '—';
            const cs = getCalculatedStatus(t);
            html += `<div class="arquivo-task">
                <div class="arquivo-task-info">
                    <strong>${escapeHtml(t.text)}</strong>
                    <small>Concluída em ${dataConclusao} · Responsáveis: ${escapeHtml(respNomes)} · <span class="status-pill ${cs.class}" style="font-size:9px;">${cs.label}</span></small>
                </div>
                <button class="btn-desarquivar" onclick="arquivarTarefa('${t.id}', false)">↺ DESARQUIVAR</button>
            </div>`;
        });
        html += `</div>`;
    });
    cont.innerHTML = html;
}

// Migração one-shot: converte usuários antigos (ID aleatório) para ID = email.
// Necessário porque as Security Rules só conseguem checar por exists(/usuarios/{email}).
let migracaoUsuariosRan = false;
async function migrarUsuariosParaEmailId() {
    if (migracaoUsuariosRan) return;
    if (currentUserRole !== 'super-admin') return;
    migracaoUsuariosRan = true;

    const candidatos = allUsers.filter(u => u.id !== u.email && u.email);
    if (candidatos.length === 0) return;

    let sucesso = 0;
    for (const u of candidatos) {
        try {
            // 1. Cria doc novo com ID = email
            await db.collection('usuarios').doc(u.email).set({
                nome: u.nome || '',
                email: u.email,
                telefone: u.telefone || '',
                papel: u.papel || 'membro'
            });
            // 2. Apaga o doc antigo de ID aleatório
            await db.collection('usuarios').doc(u.id).delete();
            sucesso++;
        } catch (e) {
            console.warn('[migracao usuarios] falhou para', u.email, e);
        }
    }
    console.log(`[migracao usuarios] ${sucesso}/${candidatos.length} usuário(s) migrados para email-as-id.`);
    if (sucesso > 0) toast(`Migração: ${sucesso} usuário(s) atualizados para o novo formato.`, 'success');
}

// Migração one-shot: preenche resp_emails (campo desnormalizado para Security Rules)
// para tarefas antigas que não tinham. Só super-admin dispara.
let migracaoRespEmailsRan = false;
async function migrarRespEmails() {
    if (migracaoRespEmailsRan) return;
    if (currentUserRole !== 'super-admin') return;
    migracaoRespEmailsRan = true;

    const candidatas = allTasks.filter(t => {
        const respsArr = Array.isArray(t.resps) ? t.resps : [];
        const expectedEmails = respsArr.map(r => r && r.email).filter(Boolean);
        const currentEmails = Array.isArray(t.resp_emails) ? t.resp_emails : null;
        if (currentEmails === null) return expectedEmails.length >= 0; // sempre que faltar campo
        // Se já existe, conferir se está em sincronia
        if (currentEmails.length !== expectedEmails.length) return true;
        const a = [...currentEmails].sort();
        const b = [...expectedEmails].sort();
        return JSON.stringify(a) !== JSON.stringify(b);
    });

    if (candidatas.length === 0) return;

    try {
        // Lotes de 400 (limite Firestore = 500 por batch)
        for (let i = 0; i < candidatas.length; i += 400) {
            const lote = candidatas.slice(i, i + 400);
            const batch = db.batch();
            lote.forEach(t => {
                const emails = (t.resps || []).map(r => r && r.email).filter(Boolean);
                batch.update(db.collection('tarefas').doc(t.id), { resp_emails: emails });
            });
            await batch.commit();
        }
        console.log(`[migracao] resp_emails populado em ${candidatas.length} tarefa(s).`);
    } catch (e) {
        console.warn('[migracao] falha:', e);
    }
}

// Auto-arquivar (fallback client-side enquanto a Cloud Function não está deployada).
// Roda 1x por sessão de gestor. Marca como arquivada toda tarefa concluída há mais de N dias.
let autoArchiveRan = false;
async function autoArchiveExpired() {
    if (autoArchiveRan) return;
    if (currentUserRole !== 'super-admin') return; // só super-admin dispara o batch
    autoArchiveRan = true;

    const cutoff = Date.now() - (AUTO_ARCHIVE_DAYS * 86400000);
    const candidatas = allTasks.filter(t => {
        if (t.arquivada) return false;
        if (t.status !== 'concluido') return false;
        if (!t.data_fim) return false;
        const fimMs = new Date(t.data_fim + 'T00:00:00').getTime();
        return fimMs < cutoff;
    });

    if (candidatas.length === 0) return;

    try {
        const batch = db.batch();
        candidatas.forEach(t => {
            batch.update(db.collection('tarefas').doc(t.id), {
                arquivada: true,
                arquivada_em: firebase.firestore.FieldValue.serverTimestamp(),
                arquivada_por: 'AUTO'
            });
        });
        await batch.commit();
        console.log(`[auto-archive] ${candidatas.length} tarefa(s) arquivadas automaticamente.`);
    } catch (e) {
        console.warn('[auto-archive] falha:', e);
    }
}
