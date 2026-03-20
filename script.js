// ==========================================================================
// VARIÁVEIS GLOBAIS E ESTADO DO SISTEMA
// ==========================================================================
let allTasks = [];
let allUsers = []; 
let allAreasData = []; 
let currentFilteredTasks = []; 
let currentTaskId = null;
let currentUserEmail = null; 
let currentUserRole = null; 
let managedAreas = []; 
let managedProjects = []; 
let biChartProgress = null;
let biChartTeam = null;

// ==========================================================================
// 1. NAVEGAÇÃO SEGURA E CONTROLE DE ACESSO
// ==========================================================================
function showSection(sec) {
    document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-link').forEach(btn => btn.classList.remove('active'));
    
    const targetSection = document.getElementById(`sec-${sec}`);
    if(targetSection) targetSection.classList.add('active');
    
    const navBtnId = sec === 'dashboard-bi' ? 'btn-nav-bi' : (sec === 'admin' ? 'btn-nav-admin' : (sec === 'acompanhamento' ? 'btn-nav-op' : `btn-nav-${sec}`));
    if(document.getElementById(navBtnId)) document.getElementById(navBtnId).classList.add('active');

    if(sec === 'usuarios') renderUsers();
    if(sec === 'admin') renderAdminPanel();
}

function updateNavVisibility() {
    const isSuperAdmin = currentUserRole === 'super-admin';
    const isGestorArea = managedAreas.length > 0;
    const isGestorProjeto = managedProjects.length > 0;
    const temPoder = isSuperAdmin || isGestorArea || isGestorProjeto;
    
    document.getElementById('btn-nav-bi').style.display = temPoder ? 'inline-block' : 'none';
    document.getElementById('btn-nav-novo').style.display = temPoder ? 'inline-block' : 'none';
    document.getElementById('btn-nav-usuarios').style.display = isSuperAdmin ? 'inline-block' : 'none';
    document.getElementById('btn-nav-admin').style.display = isSuperAdmin ? 'inline-block' : 'none';
    
    const currentActive = document.querySelector('.content-section.active')?.id;
    if (!temPoder && (currentActive === 'sec-dashboard-bi' || currentActive === 'sec-novo-projeto')) {
        showSection('acompanhamento');
    }
}

// ==========================================================================
// 2. AUTENTICAÇÃO E CARGA DE DADOS PARALELA
// ==========================================================================
auth.onAuthStateChanged(async user => {
    if (user) {
        currentUserEmail = user.email.toLowerCase();
        const userQuery = await db.collection('usuarios').where('email', '==', currentUserEmail).get();
        if (userQuery.empty) { alert("Acesso Negado."); auth.signOut(); return; }
        
        const userData = userQuery.docs[0].data();
        currentUserRole = userData.papel || 'membro'; 
        
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('app-screen').style.display = 'block';
        document.getElementById('saudacao').innerText = `Olá, ${userData.nome.split(' ')[0]}`;
        
        loadUsersDatabase();
        loadAreasEstrategicas(); 
    } else {
        document.getElementById('login-screen').style.display = 'flex';
        document.getElementById('app-screen').style.display = 'none';
    }
});

function logout() { auth.signOut(); }
document.getElementById('login-btn').onclick = () => auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());

function loadAreasEstrategicas() {
    db.collection('areas_estrategicas').onSnapshot(snapshot => {
        allAreasData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        loadDataTasks(); 
    });
}

function loadUsersDatabase() {
    db.collection('usuarios').onSnapshot(snapshot => {
        allUsers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        populateUserSelectsMaster();
        renderUsers();
        if(document.getElementById('sec-admin').classList.contains('active')) renderAdminPanel();
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
    });
}

// ==========================================================================
// 3. ADMINISTRAÇÃO AVANÇADA (ÁREAS E PROJETOS EM LOTE)
// ==========================================================================
function renderAdminPanel() {
    if(currentUserRole !== 'super-admin') return;
    
    // 1. Datalist Híbrido de Áreas (Edição ou Criação)
    let areaOptions = '<option value="">Selecione a área para editar...</option>';
    areaOptions += '<option value="NOVA_AREA" style="font-weight:bold; color:#2563eb;">➕ CRIAR NOVA ÁREA ESTRATÉGICA</option>';
    areaOptions += allAreasData.map(a => `<option value="${a.id}">${a.id}</option>`).join('');
    document.getElementById('adminAreaSelect').innerHTML = areaOptions;
    
    // 2. Checkboxes de Gestores (Estética Limpa)
    const container = document.getElementById('adminAreaGestoresContainer');
    container.innerHTML = allUsers.map(u => `
        <label class="admin-gestor-row" style="cursor: pointer;">
            <span class="bold">${u.nome}</span>
            <input type="checkbox" class="admin-gestor-check" value="${u.email}">
        </label>
    `).join('');

    // 3. Lista de Áreas Ativas
    let htmlAreas = '<ul style="padding-left: 20px;">';
    allAreasData.forEach(a => {
        // Pega os nomes bonitos em vez dos emails se possível
        const gNomes = a.gestores ? a.gestores.map(email => {
            const u = allUsers.find(user => user.email === email);
            return u ? u.nome.split(' ')[0] : email;
        }).join(', ') : 'Nenhum';
        
        htmlAreas += `<li style="margin-bottom: 8px;"><strong>${a.id}</strong> <br><span style="color:#666">Gestores: ${gNomes}</span> <button onclick="deletarArea('${a.id}')" class="btn-text" style="color:red; font-size:10px;">[EXCLUIR]</button></li>`;
    });
    document.getElementById('admin-areas-list').innerHTML = htmlAreas + '</ul>';

    // 4. Lista Clicável de Projetos
    const projs = {};
    allTasks.forEach(t => { projs[t.project] = t.area || 'Sem Área'; });
    
    let htmlProjs = '';
    Object.keys(projs).sort().forEach(p => {
        htmlProjs += `
            <div onclick="prepararEdicaoProjeto('${p}', '${projs[p]}')" style="padding: 10px; border-bottom: 1px solid #eee; cursor: pointer; display: flex; justify-content: space-between; align-items: center;" onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background='transparent'">
                <strong style="font-size: 13px;">${p}</strong>
                <span class="status-pill status-fazer" style="font-size: 9px;">${projs[p]}</span>
            </div>`;
    });
    document.getElementById('admin-projects-list').innerHTML = htmlProjs;
}

// Controle do campo Híbrido
function tratarSelecaoAreaAdmin() {
    const select = document.getElementById('adminAreaSelect');
    const input = document.getElementById('adminAreaInput');
    
    if (select.value === 'NOVA_AREA') {
        input.style.display = 'block';
        input.focus();
        document.querySelectorAll('.admin-gestor-check').forEach(cb => cb.checked = false);
    } else {
        input.style.display = 'none';
        input.value = '';
        carregarGestoresArea(select.value);
    }
}

// Carrega os checkboxes baseados na área selecionada
function carregarGestoresArea(areaId) {
    const areaExists = allAreasData.find(a => a.id === areaId);
    document.querySelectorAll('.admin-gestor-check').forEach(cb => {
        cb.checked = (areaExists && areaExists.gestores && areaExists.gestores.includes(cb.value));
    });
}

async function salvarAreaEstrategica() {
    const selectVal = document.getElementById('adminAreaSelect').value;
    const inputVal = document.getElementById('adminAreaInput').value.trim();
    
    let nomeArea = selectVal === 'NOVA_AREA' ? inputVal : selectVal;
    
    if(!nomeArea) return alert("Você deve definir um nome para a área.");

    const gestoresSelecionados = Array.from(document.querySelectorAll('.admin-gestor-check:checked')).map(cb => cb.value);
    
    await db.collection('areas_estrategicas').doc(nomeArea).set({ gestores: gestoresSelecionados });
    
    document.getElementById('adminAreaSelect').value = '';
    document.getElementById('adminAreaInput').style.display = 'none';
    document.getElementById('adminAreaInput').value = '';
    document.querySelectorAll('.admin-gestor-check').forEach(cb => cb.checked = false);
    alert("Área configurada com sucesso!");
    renderAdminPanel();
}

async function deletarArea(idArea) {
    if(!confirm(`Excluir a área ${idArea}? Os projetos vinculados a ela ficarão sem área definida.`)) return;
    await db.collection('areas_estrategicas').doc(idArea).delete();
}

// A CASCATA DE DADOS
function prepararEdicaoProjeto(projName, currArea) {
    document.getElementById('admin-edit-project-form').style.display = 'block';
    document.getElementById('adminEditProjTarget').innerText = projName;
    document.getElementById('adminNewProjectName').value = projName;
    
    // Bug corrigido: Força o re-desenho das opções aqui para garantir que estão atualizadas
    document.getElementById('adminProjectNewArea').innerHTML = '<option value="">Deixar Sem Área</option>' + allAreasData.map(a => `<option value="${a.id}">${a.id}</option>`).join('');
    document.getElementById('adminProjectNewArea').value = currArea !== 'Sem Área' ? currArea : '';
    
    document.getElementById('admin-edit-project-form').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function cancelarEdicaoProjetoAdmin() {
    document.getElementById('admin-edit-project-form').style.display = 'none';
}

async function refatorarProjetoCascata() {
    const oldName = document.getElementById('adminEditProjTarget').innerText;
    const newNameInput = document.getElementById('adminNewProjectName').value.trim();
    const newArea = document.getElementById('adminProjectNewArea').value;

    if(!oldName) return;
    const finalName = newNameInput || oldName;

    if(!confirm(`ALERTA: Você vai reescrever TODAS as tarefas vinculadas ao projeto "${oldName}". Confirma?`)) return;

    const batch = db.batch();
    const snapshot = await db.collection('tarefas').where('project', '==', oldName).get();

    if(snapshot.empty) return alert("Nenhuma tarefa encontrada neste projeto.");

    snapshot.forEach(doc => {
        const updateData = { project: finalName, area: newArea || firebase.firestore.FieldValue.delete() };
        batch.update(doc.ref, updateData);
    });

    try {
        await batch.commit();
        cancelarEdicaoProjetoAdmin();
        alert(`Operação concluída. ${snapshot.size} tarefa(s) reescrita(s).`);
        renderAdminPanel();
    } catch (e) {
        console.error("Erro fatal na escrita em lote:", e);
        alert("Erro ao processar a cascata de dados.");
    }
}

// ==========================================================================
// 4. GESTÃO DE EQUIPE
// ==========================================================================
async function cadastrarUsuario() {
    const nome = document.getElementById('novoUserNome').value.trim();
    const email = document.getElementById('novoUserEmail').value.toLowerCase().trim();
    if(nome && email) {
        await db.collection('usuarios').add({ nome, email, papel: 'membro' }); 
        document.getElementById('novoUserNome').value = '';
        document.getElementById('novoUserEmail').value = '';
        alert("Membro credenciado!");
    }
}

function renderUsers() {
    const board = document.getElementById('lista-usuarios-board');
    if(!board) return;
    let html = `<div class="table-container shadow"><table><thead><tr><th>Nome</th><th>E-mail</th><th style="text-align:right">Ação</th></tr></thead><tbody>`;
    allUsers.forEach(u => {
        html += `<tr><td class="bold">${u.nome}</td><td>${u.email}</td><td style="text-align:right">
        ${u.email !== currentUserEmail ? `<button onclick="removerUsuario('${u.id}')" class="btn-danger">REMOVER</button>` : '<small>(Você)</small>'}</td></tr>`;
    });
    board.innerHTML = html + `</tbody></table></div>`;
}
async function removerUsuario(id) { if(confirm("Revogar acesso deste membro permanentemente?")) await db.collection('usuarios').doc(id).delete(); }

// ==========================================================================
// 5. INCLUSÃO E EDIÇÃO DINÂMICA DE EQUIPES NAS TAREFAS
// ==========================================================================
function populateUserSelectsMaster() {
    const optionsHTML = '<option value="">Selecione...</option>' + allUsers.map(u => `<option value="${u.email}">${u.nome}</option>`).join('');
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
    div.style = "display: flex; gap: 10px; align-items: center;";
    
    const optionsHTML = '<option value="">Selecione o Membro...</option>' + allUsers.map(u => `<option value="${u.email}" ${u.email === presetEmail ? 'selected' : ''}>${u.nome}</option>`).join('');
    
    div.innerHTML = `
        <select class="resp-select" style="flex: 2;">${optionsHTML}</select>
        <select class="resp-role" style="flex: 1;">
            <option value="executor" ${presetRole === 'executor' ? 'selected' : ''}>Executor</option>
            <option value="gestor" ${presetRole === 'gestor' ? 'selected' : ''}>Gestor do Projeto</option>
        </select>
        <button onclick="this.parentElement.remove()" class="btn-remove-resp" title="Remover">&times;</button>
    `;
    container.appendChild(div);
}

function coletarEquipeDeContainer(containerId) {
    const resps = [];
    document.getElementById(containerId).querySelectorAll('.resp-row').forEach(row => {
        const email = row.querySelector('.resp-select').value;
        const papel = row.querySelector('.resp-role').value;
        if(email) {
            const userObj = allUsers.find(u => u.email === email);
            if(userObj && !resps.find(r => r.email === userObj.email)) {
                resps.push({ nome: userObj.nome, email: userObj.email, papel: papel });
            }
        }
    });
    return resps;
}

async function saveDemand() {
    const area = document.getElementById('areaInput').value;
    const project = document.getElementById('projectInput').value.trim();
    const title = document.getElementById('taskTitle').value.trim();
    const desc = document.getElementById('taskDesc').value.trim();
    const dateStart = document.getElementById('dateInputStart').value;
    const dateEnd = document.getElementById('dateInputEnd').value;
    
    if (currentUserRole !== 'super-admin' && !managedAreas.includes(area) && !managedProjects.includes(project)) {
        alert("Acesso Negado: Você não tem permissão de gestão nesta área/projeto.");
        return;
    }

    const resps = coletarEquipeDeContainer('responsaveis-container');
    
    if(!area || !project || !title || resps.length === 0 || !dateStart || !dateEnd) {
        return alert("Preencha Área, Projeto, Título, Datas e pelo menos um Responsável.");
    }
    
    try {
        await db.collection('tarefas').add({
            area, project, text: title, descricao: desc,
            data_inicio: dateStart, data_fim: dateEnd,
            status: 'fazer', perc_desenvolvimento: 0, resps, criadoEm: new Date(), historico: [], email: resps[0].email
        });

        for (const r of resps) {
            try { await emailjs.send("service_yw91uty", "template_p5wyzq8", { responsavel: r.nome, projeto: project, email_to: r.email }); } 
            catch (error) { console.error("Falha no email:", error); }
        }
        
        alert("Demanda lançada!");
        document.getElementById('taskTitle').value = '';
        document.getElementById('taskDesc').value = '';
        document.getElementById('responsaveis-container').innerHTML = ''; 
        addResponsavelField('responsaveis-container'); 
        showSection('acompanhamento');
    } catch (e) { alert("Erro ao lançar a demanda."); }
}

// ==========================================================================
// 6. VISÃO OPERACIONAL E MODAL DE EDIÇÃO AVANÇADO
// ==========================================================================
function getVisibleTasksBoard() {
    if (currentUserRole === 'super-admin') return allTasks;
    return allTasks.filter(t => managedAreas.includes(t.area) || managedProjects.includes(t.project) || (t.resps && t.resps.some(r => r.email === currentUserEmail)));
}

function updateProjectAndAreaLists() {
    const areaSelect = document.getElementById('areaInput');
    if(areaSelect) {
        const allowedAreas = currentUserRole === 'super-admin' ? allAreasData.map(a=>a.id) : managedAreas;
        areaSelect.innerHTML = '<option value="">Selecione a Área...</option>' + allowedAreas.map(a => `<option value="${a}">${a}</option>`).join('');
    }

    const projList = document.getElementById('projectsList');
    if(projList) projList.innerHTML = managedProjects.map(p => `<option value="${p}">`).join(''); 
    
    const filter = document.getElementById('filterProject');
    const tasks = getVisibleTasksBoard();
    const projects = [...new Set(tasks.map(t => t.project))].sort();
    const curr = filter.value;
    filter.innerHTML = '<option value="geral">Todos os Projetos</option>' + projects.map(p => `<option value="${p}">${p}</option>`).join('');
    if(curr && projects.includes(curr)) filter.value = curr;
}

function renderDashboard() {
    const tasks = getVisibleTasksBoard();
    const selected = document.getElementById('filterProject').value;
    const filtered = selected === 'geral' ? tasks : tasks.filter(t => t.project === selected);
    
    const stats = {
        total: filtered.length,
        atrasadas: filtered.filter(t => t.status !== 'concluido' && t.data_fim && new Date(t.data_fim) < new Date()).length,
        pendentes: filtered.filter(t => t.status === 'aprovacao').length,
        concluidas: filtered.filter(t => t.status === 'concluido').length
    };
    
    document.getElementById('bi-kpi-total').innerText = stats.total;
    
    document.getElementById('stats-grid').innerHTML = `
        <div class="stat-card shadow"><h3>${stats.total}</h3><p>Demandas</p></div>
        <div class="stat-card shadow" style="border-left:4px solid #dc3545"><h3>${stats.atrasadas}</h3><p>Atrasadas</p></div>
        <div class="stat-card shadow" style="border-left:4px solid #000"><h3>${stats.pendentes}</h3><p>Em Aprovação</p></div>
        <div class="stat-card shadow" style="border-left:4px solid #28a745"><h3>${stats.concluidas}</h3><p>Concluídas</p></div>`;

    renderBoard();
}

function renderBoard() {
    const board = document.getElementById('projectsBoard');
    const tasks = getVisibleTasksBoard();
    const selected = document.getElementById('filterProject').value;
    const filtered = selected === 'geral' ? tasks : tasks.filter(t => t.project === selected);
    
    if (filtered.length === 0) {
        board.innerHTML = '<p style="padding: 30px; text-align: center; color: #888;">Nenhuma demanda encontrada.</p>';
        return;
    }

    const grouped = {};
    filtered.forEach(t => { if (!grouped[t.project]) grouped[t.project] = []; grouped[t.project].push(t); });

    let html = '';
    Object.keys(grouped).sort().forEach(projName => {
        const projArea = grouped[projName][0].area || 'Sem Área';
        html += `<div style="background: #f8fafc; padding: 12px 20px; border-bottom: 1px solid var(--border-color); margin-top: 15px;">
                    <h4 style="margin: 0; font-size: 13px; text-transform: uppercase;">📁 ${projName} <span style="font-weight:400; color:#64748b; font-size:10px;">(${projArea})</span></h4>
                 </div><table style="margin-bottom: 0;"><thead><tr><th style="width:40%">Tarefa</th><th style="width:20%">Prazo</th><th style="width:20%">Responsáveis</th><th style="width:20%">Status</th></tr></thead><tbody>`;
        
        grouped[projName].forEach(t => {
            const sClass = `status-${t.status === 'concluido' ? 'concluido' : (t.status === 'aprovacao' ? 'andamento' : 'fazer')}`;
            const respNames = t.resps && t.resps.length > 0 ? t.resps.map(r => r.nome.split(' ')[0]).join(', ') : '-';
            html += `<tr onclick="abrirModal('${t.id}')" style="cursor:pointer">
                <td class="bold">${t.text}</td><td>${t.data_fim ? t.data_fim.split('-').reverse().join('/') : 'N/D'}</td>
                <td style="font-size: 11px;">${respNames}</td><td><span class="status-pill ${sClass}">${t.status.toUpperCase()}</span></td></tr>`;
        });
        html += `</tbody></table>`;
    });
    board.innerHTML = html;
}

function abrirModal(id) {
    currentTaskId = id;
    const t = allTasks.find(x => x.id === id);
    document.getElementById('taskModal').classList.add('active');
    
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
    document.getElementById('editPerc').value = t.perc_desenvolvimento || 0;
    document.getElementById('editStatus').value = t.status;
    
    const containerResps = document.getElementById('edit-responsaveis-container');
    containerResps.innerHTML = ''; 
    if(t.resps) {
        t.resps.forEach(r => addResponsavelField('edit-responsaveis-container', r.email, r.papel));
    }
    
    document.getElementById('btn-add-edit-resp').style.display = isGestorPleno ? 'inline-block' : 'none';
    document.querySelectorAll('#edit-responsaveis-container select').forEach(sel => sel.disabled = !isGestorPleno);
    document.querySelectorAll('.btn-remove-resp').forEach(btn => btn.style.display = isGestorPleno ? 'inline-block' : 'none');

    document.getElementById('opt-concluido').style.display = isGestorPleno ? 'block' : 'none';
    document.getElementById('btn-delete-task').style.display = isGestorPleno ? 'inline-block' : 'none';
    
    const hist = document.getElementById('modalHistorico');
    hist.innerHTML = (t.historico && t.historico.length > 0) ? t.historico.map(h => `<div class="history-item"><strong>${h.autor.split('@')[0]}</strong> <small>${h.data}</small><br>${h.texto}</div>`).join('') : "<em>Sem reportes.</em>";
}

function closeModal() { document.getElementById('taskModal').classList.remove('active'); }
document.addEventListener('keydown', (e) => { 
    if(e.key === "Escape") { closeModal(); if (typeof closeDrilldown === "function") closeDrilldown(); } 
});

async function saveModalChanges() {
    const t = allTasks.find(x => x.id === currentTaskId);
    const isGestorPleno = currentUserRole === 'super-admin' || managedAreas.includes(t.area) || managedProjects.includes(t.project);
    const report = document.getElementById('newReport').value.trim();
    
    const update = { 
        status: document.getElementById('editStatus').value, 
        perc_desenvolvimento: parseInt(document.getElementById('editPerc').value) || 0 
    };
    
    if(isGestorPleno) {
        update.text = document.getElementById('editTitle').value;
        update.data_inicio = document.getElementById('editDateStart').value;
        update.data_fim = document.getElementById('editDateEnd').value;
        update.resps = coletarEquipeDeContainer('edit-responsaveis-container');
    }
    
    let hasMeaningfulChange = false;
    let systemMsg = "";

    if(report) {
        update.historico = firebase.firestore.FieldValue.arrayUnion({ data: new Date().toLocaleString('pt-BR'), autor: currentUserEmail, texto: report });
        hasMeaningfulChange = true;
    } else if (update.status !== t.status || update.perc_desenvolvimento !== t.perc_desenvolvimento) {
        systemMsg = `Atualizou: Status [${update.status.toUpperCase()}] - Progresso ${update.perc_desenvolvimento}%`;
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

            for (const emailTo of recipientsEmails) {
                try {
                    await emailjs.send("service_yw91uty", "template_dexwd15", {
                        projeto: t.project, tarefa: update.text || t.text,
                        autor_atualizacao: currentUserEmail, novo_status: update.status.toUpperCase(),
                        progresso: update.perc_desenvolvimento, reporte: report || systemMsg, email_to: emailTo
                    });
                } catch (error) { console.error("Falha no envio de e-mail:", error); }
            }
        }
        document.getElementById('newReport').value = "";
        closeModal();
    } catch (e) { alert("Falha ao salvar as alterações."); }
}

async function deleteTask() { if(confirm("Excluir definitivamente?")) { await db.collection('tarefas').doc(currentTaskId).delete(); closeModal(); } }

// ==========================================================================
// 7. BUSINESS INTELLIGENCE
// ==========================================================================
function toggleFilterMenu(type) { 
    document.querySelectorAll('.dropdown-content').forEach(el => { if (el.id !== `filter-checkboxes-${type}`) el.classList.remove('show'); });
    document.getElementById(`filter-checkboxes-${type}`).classList.toggle('show'); 
}
window.onclick = function(e) { if (!e.target.matches('.dropdown-btn') && !e.target.closest('.dropdown-content')) { document.querySelectorAll('.dropdown-content.show').forEach(el => el.classList.remove('show')); } }

function updateBIAreaFilter() {
    const container = document.getElementById('filter-checkboxes-area');
    if(!container) return;
    
    const checkedBoxes = Array.from(document.querySelectorAll('.bi-area-check:checked')).map(cb => cb.value);
    
    const allowedTasks = currentUserRole === 'super-admin' ? allTasks : allTasks.filter(t => managedAreas.includes(t.area) || managedProjects.includes(t.project));
    const allAreas = [...new Set(allowedTasks.map(t => t.area || 'Sem Área'))].sort();
    
    let html = `<label class="checkbox-item"><input type="checkbox" id="check-all-area" onchange="toggleAllAreas(this)" ${checkedBoxes.length === 0 || checkedBoxes.includes('ALL') ? 'checked' : ''}><strong>[ TODAS AS ÁREAS ]</strong></label>`;
    allAreas.forEach(a => {
        const isChecked = checkedBoxes.includes(a) || (checkedBoxes.length === 0 && document.getElementById('check-all-area')?.checked) ? 'checked' : '';
        html += `<label class="checkbox-item"><input type="checkbox" class="bi-area-check" value="${a}" onchange="updateBIProjectFilter()" ${isChecked}>${a}</label>`;
    });
    container.innerHTML = html;
    updateBIProjectFilter(); 
}

function toggleAllAreas(masterCheckbox) { document.querySelectorAll('.bi-area-check').forEach(cb => cb.checked = masterCheckbox.checked); updateBIProjectFilter(); }

function updateBIProjectFilter() {
    const container = document.getElementById('filter-checkboxes-proj');
    if(!container) return;
    
    const masterAreaCheck = document.getElementById('check-all-area');
    const selectedAreas = Array.from(document.querySelectorAll('.bi-area-check:checked')).map(cb => cb.value);
    const btnAreaText = document.getElementById('btn-filter-area');
    
    let allowedTasks = currentUserRole === 'super-admin' ? allTasks : allTasks.filter(t => managedAreas.includes(t.area) || managedProjects.includes(t.project));
    
    if (masterAreaCheck && masterAreaCheck.checked) { btnAreaText.innerText = "[ TODAS AS ÁREAS ] ▾"; } 
    else if (selectedAreas.length > 0) { btnAreaText.innerText = `${selectedAreas.length} ÁREA(S) ▾`; allowedTasks = allowedTasks.filter(t => selectedAreas.includes(t.area || 'Sem Área')); } 
    else { btnAreaText.innerText = "NENHUMA ÁREA ▾"; allowedTasks = []; }

    const previouslyCheckedProjs = Array.from(document.querySelectorAll('.bi-proj-check:checked')).map(cb => cb.value);
    const allowedProjects = [...new Set(allowedTasks.map(t => t.project))].sort();
    
    let html = `<label class="checkbox-item"><input type="checkbox" id="check-all-proj" onchange="toggleAllProjects(this)" ${previouslyCheckedProjs.length === 0 || previouslyCheckedProjs.includes('ALL') ? 'checked' : ''}><strong>[ TODOS PERMITIDOS ]</strong></label>`;
    allowedProjects.forEach(p => {
        const isChecked = previouslyCheckedProjs.includes(p) || (previouslyCheckedProjs.length === 0 && document.getElementById('check-all-proj')?.checked) ? 'checked' : '';
        html += `<label class="checkbox-item"><input type="checkbox" class="bi-proj-check" value="${p}" onchange="renderNativeBI()" ${isChecked}>${p}</label>`;
    });
    container.innerHTML = html;
    renderNativeBI(); 
}

function toggleAllProjects(masterCheckbox) { document.querySelectorAll('.bi-proj-check').forEach(cb => cb.checked = masterCheckbox.checked); renderNativeBI(); }

function renderNativeBI() {
    const masterCheck = document.getElementById('check-all-proj');
    const checkboxes = Array.from(document.querySelectorAll('.bi-proj-check:checked')).map(cb => cb.value);
    const btnText = document.getElementById('btn-filter-proj');
    
    const selectedAreas = Array.from(document.querySelectorAll('.bi-area-check:checked')).map(cb => cb.value);
    const masterAreaCheck = document.getElementById('check-all-area');
    
    let baseTasks = currentUserRole === 'super-admin' ? allTasks : allTasks.filter(t => managedAreas.includes(t.area) || managedProjects.includes(t.project));
    
    if (!(masterAreaCheck && masterAreaCheck.checked)) { baseTasks = baseTasks.filter(t => selectedAreas.includes(t.area || 'Sem Área')); }

    if (masterCheck && masterCheck.checked) { btnText.innerText = "[ TODOS OS PROJETOS ] ▾"; currentFilteredTasks = baseTasks; } 
    else if (checkboxes.length > 0) { btnText.innerText = `${checkboxes.length} PROJETO(S) ▾`; currentFilteredTasks = baseTasks.filter(t => checkboxes.includes(t.project)); } 
    else { btnText.innerText = "NENHUM PROJETO ▾"; currentFilteredTasks = []; }

    const today = new Date(); today.setHours(0,0,0,0);
    let kpis = { total: currentFilteredTasks.length, nao_iniciada: 0, execucao: 0, atraso: 0 };

    currentFilteredTasks.forEach(t => {
        const dInicio = t.data_inicio ? new Date(t.data_inicio + 'T00:00:00') : null;
        const dFim = t.data_fim ? new Date(t.data_fim + 'T00:00:00') : null;
        if (dInicio && dInicio < today && t.status === 'fazer') kpis.nao_iniciada++;
        if (dInicio && dInicio <= today && t.status !== 'fazer') kpis.execucao++;
        if (dFim && dFim < today && t.status !== 'concluido') kpis.atraso++;
    });

    document.getElementById('bi-kpi-total').innerText = kpis.total;
    document.getElementById('bi-kpi-nao-iniciada').innerText = kpis.nao_iniciada;
    document.getElementById('bi-kpi-execucao').innerText = kpis.execucao;
    document.getElementById('bi-kpi-atraso').innerText = kpis.atraso;

    const concluidas = currentFilteredTasks.filter(t => t.status === 'concluido').length;
    const pendentes = kpis.total - concluidas;
    
    if(biChartProgress) biChartProgress.destroy();
    biChartProgress = new Chart(document.getElementById('biProgressChart'), { 
        type: 'doughnut', data: { labels: ['Concluído', 'Pendente'], datasets: [{ data: [concluidas, pendentes], backgroundColor: ['#10b981', '#1e293b'] }] }, 
        options: { responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { tooltip: { callbacks: { label: function(c) { let v=c.parsed, t=c.dataset.data.reduce((a,b)=>a+b,0), p=t>0?Math.round((v/t)*100):0; return ` ${c.label}: ${v} (${p}%)`; }}}}} 
    });

    const teamLoad = {};
    currentFilteredTasks.forEach(t => { 
        if(t.resps && t.resps.length > 0) { t.resps.forEach(r => { const rn = r.nome.split(' ')[0]; teamLoad[rn] = (teamLoad[rn] || 0) + 1; }); } 
        else { teamLoad['Sem Dono'] = (teamLoad['Sem Dono'] || 0) + 1; }
    });
    
    if(biChartTeam) biChartTeam.destroy();
    biChartTeam = new Chart(document.getElementById('biTeamChart'), { type: 'bar', data: { labels: Object.keys(teamLoad), datasets: [{ label: 'Tarefas Atribuídas', data: Object.values(teamLoad), backgroundColor: '#0f172a', borderRadius: 4 }] }, options: { responsive: true, maintainAspectRatio: false } });

    drawExecutiveGantt(currentFilteredTasks);
}

function drawExecutiveGantt(tasks) {
    const tbody = document.getElementById('bi-gantt-body');
    if(!tbody) return;
    tbody.innerHTML = '';
    const gTasks = tasks.filter(t => t.data_inicio && t.data_fim);
    if(gTasks.length === 0) { tbody.innerHTML = '<tr><td colspan="2" style="text-align:center; color:#888;">Nenhum cronograma definido.</td></tr>'; return; }

    let minDate = new Date(Math.min(...gTasks.map(t => new Date(t.data_inicio + 'T00:00:00'))));
    let maxDate = new Date(Math.max(...gTasks.map(t => new Date(t.data_fim + 'T00:00:00'))));
    minDate.setDate(minDate.getDate() - 1); maxDate.setDate(maxDate.getDate() + 1);
    const totalDuration = maxDate - minDate;

    const today = new Date(); today.setHours(0,0,0,0);
    const todayPerc = ((today - minDate) / totalDuration) * 100;
    let todayMarker = (todayPerc >= 0 && todayPerc <= 100) ? `<div class="gantt-today-marker" style="left: ${todayPerc}%;" title="Linha do Tempo: Hoje"></div>` : '';

    let html = '';
    gTasks.forEach(t => {
        const start = new Date(t.data_inicio + 'T00:00:00');
        const end = new Date(t.data_fim + 'T00:00:00');
        const leftPerc = ((start - minDate) / totalDuration) * 100;
        const widthPerc = Math.max(((end - start) / totalDuration) * 100, 2);
        const barClass = t.status === 'concluido' ? 'concluido' : (end < today ? 'atrasado' : '');
        const respNames = t.resps && t.resps.length > 0 ? t.resps.map(r => r.nome.split(' ')[0]).join(', ') : '-';
        
        const fStart = start.toLocaleDateString('pt-BR', {day: '2-digit', month: '2-digit', year:'numeric'});
        const fEnd = end.toLocaleDateString('pt-BR', {day: '2-digit', month: '2-digit', year:'numeric'});

        html += `<tr><td><strong style="font-size: 13px;">${t.text}</strong><br><small style="color:#64748b;">[${t.project}] • Resp: ${respNames}</small></td>
        <td><div class="gantt-track">${todayMarker}<div class="gantt-bar-fill ${barClass}" style="left: ${leftPerc}%; width: ${widthPerc}%;" title="Início: ${fStart}&#10;Término: ${fEnd}&#10;Status: ${t.status.toUpperCase()}"><span>📅 ${start.toLocaleDateString('pt-BR', {day: '2-digit', month: '2-digit'})} até ${end.toLocaleDateString('pt-BR', {day: '2-digit', month: '2-digit'})} • ${t.perc_desenvolvimento || 0}%</span></div></div></td></tr>`;
    });
    tbody.innerHTML = html;
}

function openDrilldown(type) {
    const modal = document.getElementById('drilldownModal');
    const tbody = document.getElementById('drilldownBody');
    const title = document.getElementById('drilldownTitle');
    let targetTasks = [];
    const today = new Date(); today.setHours(0,0,0,0);

    if (type === 'total') { title.innerText = "Detalhamento: Total de Demandas"; targetTasks = currentFilteredTasks; }
    else if (type === 'nao_iniciada') { title.innerText = "Demandas Não Iniciadas (Atraso no Start)"; targetTasks = currentFilteredTasks.filter(t => t.data_inicio && new Date(t.data_inicio + 'T00:00:00') < today && t.status === 'fazer'); }
    else if (type === 'execucao') { title.innerText = "Demandas Em Execução"; targetTasks = currentFilteredTasks.filter(t => t.data_inicio && new Date(t.data_inicio + 'T00:00:00') <= today && t.status !== 'fazer'); }
    else if (type === 'atraso') { title.innerText = "Demandas com Prazo Vencido"; targetTasks = currentFilteredTasks.filter(t => t.data_fim && new Date(t.data_fim + 'T00:00:00') < today && t.status !== 'concluido'); }

    if (targetTasks.length === 0) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Nenhuma tarefa encontrada.</td></tr>'; }
    else {
        tbody.innerHTML = targetTasks.map(t => {
            const respNames = t.resps && t.resps.length > 0 ? t.resps.map(r => r.nome.split(' ')[0]).join(', ') : '-';
            const sClass = `status-${t.status === 'concluido' ? 'concluido' : (t.status === 'aprovacao' ? 'andamento' : 'fazer')}`;
            return `<tr><td style="font-size:11px; color:#666;">${t.area || '-'}</td><td class="bold">${t.project}</td><td>${t.text}</td><td>${t.data_fim ? t.data_fim.split('-').reverse().join('/') : 'N/D'}</td><td>${respNames}</td><td><span class="status-pill ${sClass}">${t.status.toUpperCase()}</span></td></tr>`;
        }).join('');
    }
    modal.classList.add('active');
}

function closeDrilldown() { document.getElementById('drilldownModal').classList.remove('active'); }