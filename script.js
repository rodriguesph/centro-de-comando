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
let biSelectedUsers = []; 

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
// 2. AUTENTICAÇÃO E CARGA DE DADOS
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
        allUsers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a, b) => a.nome.localeCompare(b.nome));
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
// 3. ADMINISTRAÇÃO AVANÇADA
// ==========================================================================
function renderAdminPanel() {
    if(currentUserRole !== 'super-admin') return;
    
    const formalAreas = allAreasData.map(a => a.id);
    const inferredAreas = [...new Set(allTasks.map(t => t.area).filter(a => a && a !== 'Sem Área'))];
    const allCombinedAreas = [...new Set([...formalAreas, ...inferredAreas])].sort((a, b) => a.localeCompare(b));

    let areaOptions = '<option value="">Selecione a área para editar ou formalizar...</option>';
    areaOptions += '<option value="NOVA_AREA" style="font-weight:bold; color:#2563eb;">➕ CRIAR NOVA ÁREA ESTRATÉGICA</option>';
    allCombinedAreas.forEach(a => {
        const isGhost = !formalAreas.includes(a) ? ' 👻 (FANTASMA - Formalize)' : '';
        areaOptions += `<option value="${a}">${a}${isGhost}</option>`;
    });
    document.getElementById('adminAreaSelect').innerHTML = areaOptions;
    
    const container = document.getElementById('adminAreaGestoresContainer');
    container.innerHTML = allUsers.map(u => `
        <label class="admin-gestor-row" style="cursor: pointer;">
            <span class="bold">${u.nome}</span>
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
                <div><strong style="font-size: 14px; color: #0f172a;">${a}</strong><br><span style="color:#64748b; font-size:10px; font-weight:700;">GESTORES: <span style="font-weight:500; color:#334155;">${gNomes.toUpperCase()}</span></span></div>
                <button onclick="deletarArea('${a}')" style="background: #fff5f5; border: 1px solid #fc8181; color: #c53030; padding: 6px 12px; border-radius: 4px; font-size: 10px; font-weight: bold; cursor: pointer;">EXCLUIR</button>
            </div>`;
        } else {
            htmlAreas += `
            <div style="padding: 12px 15px; border: 1px dashed #f59e0b; border-radius: 6px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; background: #fffbeb;">
                <div><strong style="font-size: 14px; color: #92400e;">${a}</strong><br><span style="color:#d97706; font-size:10px; font-weight:bold;">[ FANTASMA ]</span></div>
            </div>`;
        }
    });
    document.getElementById('admin-areas-list').innerHTML = htmlAreas;

    const projs = {};
    allTasks.forEach(t => { projs[t.project] = t.area || 'Sem Área'; });
    
    let htmlProjs = '';
    Object.keys(projs).sort((a, b) => a.localeCompare(b)).forEach(p => {
        htmlProjs += `<div onclick="prepararEdicaoProjeto('${p}', '${projs[p]}')" style="padding: 10px; border-bottom: 1px solid #eee; cursor: pointer; display: flex; justify-content: space-between; align-items: center;"><strong style="font-size: 13px;">${p}</strong><span class="status-pill status-fazer" style="font-size: 9px;">${projs[p]}</span></div>`;
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
    if(!nomeArea) return alert("Você deve definir um nome para a área.");
    const gestoresSelecionados = Array.from(document.querySelectorAll('.admin-gestor-check:checked')).map(cb => cb.value);
    await db.collection('areas_estrategicas').doc(nomeArea).set({ gestores: gestoresSelecionados });
    document.getElementById('adminAreaSelect').value = '';
    document.getElementById('adminAreaInput').style.display = 'none';
    document.getElementById('adminAreaInput').value = '';
    document.querySelectorAll('.admin-gestor-check').forEach(cb => cb.checked = false);
    renderAdminPanel();
}

async function deletarArea(idArea) { if(confirm(`Excluir a área ${idArea}?`)) await db.collection('areas_estrategicas').doc(idArea).delete(); }

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
    if(!oldName) return;
    const finalName = newNameInput || oldName;

    if(!confirm(`ALERTA: Você vai reescrever TODAS as tarefas de "${oldName}". Confirma?`)) return;
    const batch = db.batch();
    const snapshot = await db.collection('tarefas').where('project', '==', oldName).get();
    if(snapshot.empty) return;
    snapshot.forEach(doc => {
        const updateData = { project: finalName, area: newArea || firebase.firestore.FieldValue.delete() };
        batch.update(doc.ref, updateData);
    });
    try { await batch.commit(); cancelarEdicaoProjetoAdmin(); alert("Operação concluída."); renderAdminPanel(); } catch (e) { alert("Erro ao processar lote."); }
}

// ==========================================================================
// 4. GESTÃO DE EQUIPE
// ==========================================================================
async function cadastrarUsuario() {
    const nome = document.getElementById('novoUserNome').value.trim();
    const email = document.getElementById('novoUserEmail').value.toLowerCase().trim();
    if(nome && email) {
        await db.collection('usuarios').add({ nome, email, papel: 'membro' }); 
        document.getElementById('novoUserNome').value = ''; document.getElementById('novoUserEmail').value = '';
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
async function removerUsuario(id) { if(confirm("Revogar acesso deste membro?")) await db.collection('usuarios').doc(id).delete(); }

// ==========================================================================
// 5. INCLUSÃO CASCATA E DUPLICAÇÃO DE TAREFAS
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
    div.style = "display: flex; gap: 10px; align-items: center; margin-bottom: 5px;";
    
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

// O MOTOR CASCATA DE INCLUSÃO
function tratarSelecaoAreaNovoProjeto() {
    const areaSelect = document.getElementById('areaInput');
    const projSelect = document.getElementById('projectSelect');
    const projInput = document.getElementById('projectInputNovo');

    if(!areaSelect || !projSelect) return;

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
    html += '<option value="NOVO_PROJETO" style="font-weight:bold; color:#2563eb;">➕ CRIAR NOVO PROJETO</option>';
    uniqueProjs.forEach(p => { html += `<option value="${p}">${p}</option>`; });

    projSelect.innerHTML = html;
}

function tratarSelecaoProjetoNovo() {
    const projSelect = document.getElementById('projectSelect');
    const projInput = document.getElementById('projectInputNovo');
    if(projSelect.value === 'NOVO_PROJETO') {
        projInput.style.display = 'block';
        projInput.focus();
    } else {
        projInput.style.display = 'none';
        projInput.value = '';
    }
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
    
    if (currentUserRole !== 'super-admin' && !managedAreas.includes(area) && !managedProjects.includes(project) && projSelectVal !== 'NOVO_PROJETO') {
        return alert("Acesso Negado: Sem permissão nesta área/projeto.");
    }

    const resps = coletarEquipeDeContainer('responsaveis-container');
    if(!area || !project || !title || resps.length === 0 || !dateStart || !dateEnd) { return alert("Preencha Área, Projeto, Título, Datas e Responsável."); }
    
    try {
        const batch = db.batch();
        for (const r of resps) {
            const newDocRef = db.collection('tarefas').doc(); 
            batch.set(newDocRef, {
                area, project, text: title, descricao: desc, data_inicio: dateStart, data_fim: dateEnd,
                status: 'fazer', resps: [r], criadoEm: new Date(), historico: [], email: r.email
            });
        }
        await batch.commit();

        for (const r of resps) {
            try { await emailjs.send("service_yw91uty", "template_p5wyzq8", { responsavel: r.nome, projeto: project, email_to: r.email }); } 
            catch (error) { console.error("Falha no email:", error); }
        }
        
        alert(`${resps.length} demanda(s) independente(s) lançada(s)!`);
        document.getElementById('taskTitle').value = ''; document.getElementById('taskDesc').value = '';
        document.getElementById('responsaveis-container').innerHTML = ''; addResponsavelField('responsaveis-container'); 
        showSection('acompanhamento');
    } catch (e) { alert("Erro ao lançar as demandas."); }
}

// A CLONAGEM DE DEMANDA A PARTIR DO MODAL
async function duplicarTask() {
    const t = allTasks.find(x => x.id === currentTaskId);
    if(!t) return;

    if(!confirm(`Deseja criar uma cópia da demanda "${t.text}"?`)) return;

    try {
        const batch = db.batch();
        const newDocRef = db.collection('tarefas').doc();
        batch.set(newDocRef, {
            area: t.area || "Sem Área", project: t.project, text: t.text, descricao: t.descricao || "",
            data_inicio: t.data_inicio || "", data_fim: t.data_fim || "", status: 'fazer',
            resps: t.resps || [], criadoEm: new Date(), historico: [{ data: new Date().toLocaleString('pt-BR'), autor: "SISTEMA", texto: `Demanda duplicada a partir de outra tarefa.` }],
            email: t.email || (t.resps && t.resps.length > 0 ? t.resps[0].email : "")
        });
        
        await batch.commit();
        alert("Tarefa duplicada com sucesso! Você está editando a cópia agora.");
        abrirModal(newDocRef.id);
    } catch (e) { alert("Erro ao duplicar a demanda."); }
}

// ==========================================================================
// 6. VISÃO OPERACIONAL E MODAL DE EDIÇÃO
// ==========================================================================
function getVisibleTasksBoard() {
    if (currentUserRole === 'super-admin') return allTasks;
    return allTasks.filter(t => managedAreas.includes(t.area) || managedProjects.includes(t.project) || (t.resps && t.resps.some(r => r.email === currentUserEmail)));
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
    
    if(areaSelect) {
        const currentVal = areaSelect.value;
        areaSelect.innerHTML = '<option value="">Selecione a Área...</option>' + allowedAreas.map(a => `<option value="${a}">${a}</option>`).join('');
        if(currentVal && allowedAreas.includes(currentVal)) areaSelect.value = currentVal;
        tratarSelecaoAreaNovoProjeto(); // Aciona o gatilho da cascata no Novo Projeto
    }

    const filterAreaOp = document.getElementById('filterAreaOp');
    if(filterAreaOp) {
        const currArea = filterAreaOp.value;
        filterAreaOp.innerHTML = '<option value="geral">Todas as Áreas</option>' + allowedAreas.map(a => `<option value="${a}">${a}</option>`).join('');
        if(currArea && allowedAreas.includes(currArea)) filterAreaOp.value = currArea;
    }

    updateOpProjectFilter(); 
}

function updateOpProjectFilter() {
    const filterAreaOp = document.getElementById('filterAreaOp');
    const filterProjectOp = document.getElementById('filterProjectOp');
    if(!filterAreaOp || !filterProjectOp) return;

    const selectedArea = filterAreaOp.value;
    let tasks = getVisibleTasksBoard();
    if (selectedArea !== 'geral') { tasks = tasks.filter(t => (t.area || 'Sem Área') === selectedArea); }

    const projects = [...new Set(tasks.map(t => t.project))].sort((a, b) => a.localeCompare(b));
    const currProj = filterProjectOp.value;

    filterProjectOp.innerHTML = '<option value="geral">Todos os Projetos</option>' + projects.map(p => `<option value="${p}">${p}</option>`).join('');
    if(currProj && projects.includes(currProj)) filterProjectOp.value = currProj;

    renderDashboard(); 
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
    
    document.getElementById('stats-grid').innerHTML = `
        <div class="stat-card shadow"><h3>${stats.total}</h3><p>Demandas</p></div>
        <div class="stat-card shadow" style="border-left:4px solid #dc3545"><h3>${stats.criticas}</h3><p>Críticas (Vencidas)</p></div>
        <div class="stat-card shadow" style="border-left:4px solid #f59e0b"><h3>${stats.pendentes}</h3><p>Aguardando Validação</p></div>
        <div class="stat-card shadow" style="border-left:4px solid #10b981"><h3>${stats.concluidas}</h3><p>Concluídas</p></div>`;

    renderBoard(filtered);
}

function renderBoard(filteredTasks) {
    const board = document.getElementById('projectsBoard');
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
                    <h4 style="margin: 0; font-size: 13px; text-transform: uppercase;">📁 ${projName} <span style="font-weight:400; color:#64748b; font-size:10px;">(${projArea})</span></h4>
                 </div><table style="margin-bottom: 0;"><thead><tr><th style="width:40%">Tarefa</th><th style="width:20%">Prazo</th><th style="width:20%">Responsável</th><th style="width:20%">Status</th></tr></thead><tbody>`;
        
        grouped[projName].forEach(t => {
            const calcStatus = getCalculatedStatus(t);
            const respNames = t.resps && t.resps.length > 0 ? t.resps.map(r => r.nome.split(' ')[0]).join(', ') : '-';
            html += `<tr onclick="abrirModal('${t.id}')" style="cursor:pointer">
                <td class="bold">${t.text}</td><td>${t.data_fim ? t.data_fim.split('-').reverse().join('/') : 'N/D'}</td>
                <td style="font-size: 11px;">${respNames}</td><td><span class="status-pill ${calcStatus.class}">${calcStatus.label}</span></td></tr>`;
        });
        html += `</tbody></table>`;
    });
    board.innerHTML = html;
}

function abrirModal(id) {
    closeDrilldown(); 
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
    if(t.resps) { t.resps.forEach(r => addResponsavelField('edit-responsaveis-container', r.email, r.papel)); }
    
    document.getElementById('btn-add-edit-resp').style.display = isGestorPleno ? 'inline-block' : 'none';
    document.querySelectorAll('#edit-responsaveis-container select').forEach(sel => sel.disabled = !isGestorPleno);
    document.querySelectorAll('.btn-remove-resp').forEach(btn => btn.style.display = isGestorPleno ? 'inline-block' : 'none');

    document.getElementById('btn-delete-task').style.display = isGestorPleno ? 'inline-block' : 'none';
    document.getElementById('btn-duplicar-task').style.display = isGestorPleno ? 'inline-block' : 'none';
    
    const hist = document.getElementById('modalHistorico');
    hist.innerHTML = (t.historico && t.historico.length > 0) ? t.historico.map(h => `<div class="history-item"><strong>${h.autor.split('@')[0]}</strong> <small>${h.data}</small><br>${h.texto}</div>`).join('') : "<em>Sem reportes.</em>";
}

function closeModal() { document.getElementById('taskModal').classList.remove('active'); }

document.addEventListener('keydown', (e) => { 
    if(e.key === "Escape") { closeModal(); if (typeof closeDrilldown === "function") closeDrilldown(); } 
});
window.onclick = function(e) { 
    if (!e.target.matches('.dropdown-btn') && !e.target.closest('.dropdown-content')) { document.querySelectorAll('.dropdown-content.show').forEach(el => el.classList.remove('show')); } 
    if (e.target.classList.contains('modal')) { closeModal(); closeDrilldown(); }
}

async function saveModalChanges() {
    const t = allTasks.find(x => x.id === currentTaskId);
    const isGestorPleno = currentUserRole === 'super-admin' || managedAreas.includes(t.area) || managedProjects.includes(t.project);
    const report = document.getElementById('newReport').value.trim();
    
    const currentStatus = document.getElementById('editStatus').value;
    const currentTitle = document.getElementById('editTitle').value.trim();
    const currentDataInicio = document.getElementById('editDateStart').value;
    const currentDataFim = document.getElementById('editDateEnd').value;
    const currentResps = coletarEquipeDeContainer('edit-responsaveis-container');
    
    // SISTEMA ANTIFRAUDE E VERIFICADOR DE ALTERAÇÕES
    let hasAnyChange = false;
    if (report !== "") hasAnyChange = true;
    if (currentStatus !== t.status) hasAnyChange = true;
    if (isGestorPleno) {
        if (currentTitle !== t.text) hasAnyChange = true;
        if (currentDataInicio !== (t.data_inicio || "")) hasAnyChange = true;
        if (currentDataFim !== (t.data_fim || "")) hasAnyChange = true;
        const cRespsStr = JSON.stringify(currentResps.map(r=>r.email).sort());
        const tRespsStr = JSON.stringify((t.resps || []).map(r=>r.email).sort());
        if (cRespsStr !== tRespsStr) hasAnyChange = true;
    }

    if (!hasAnyChange) {
        const manter = confirm("Nenhuma alteração de texto, equipe ou data foi detectada nesta atividade.\nDeseja mesmo salvá-la mantendo-a exatamente igual no banco de dados?");
        if (!manter) return; 
        else { closeModal(); return; }
    }

    const update = { status: currentStatus };
    if(isGestorPleno) {
        update.text = currentTitle;
        update.data_inicio = currentDataInicio;
        update.data_fim = currentDataFim;
        update.resps = currentResps;
    }
    
    let hasMeaningfulChange = false; let systemMsg = "";

    if(report) {
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

            for (const emailTo of recipientsEmails) {
                try {
                    await emailjs.send("service_yw91uty", "template_dexwd15", {
                        projeto: t.project, tarefa: update.text || t.text,
                        autor_atualizacao: currentUserEmail, novo_status: update.status.toUpperCase(),
                        progresso: "Ver no Sistema", reporte: report || systemMsg, email_to: emailTo
                    });
                } catch (error) { console.error("Falha no e-mail:", error); }
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

function updateBIAreaFilter() {
    const container = document.getElementById('filter-checkboxes-area');
    if(!container) return;
    const checkedBoxes = Array.from(document.querySelectorAll('.bi-area-check:checked')).map(cb => cb.value);
    const allowedTasks = currentUserRole === 'super-admin' ? allTasks : allTasks.filter(t => managedAreas.includes(t.area) || managedProjects.includes(t.project));
    const allAreas = [...new Set(allowedTasks.map(t => t.area || 'Sem Área'))].sort((a, b) => a.localeCompare(b));
    let html = `<label class="checkbox-item"><input type="checkbox" id="check-all-area" onchange="toggleAllAreas(this)" ${checkedBoxes.length === 0 || checkedBoxes.includes('ALL') ? 'checked' : ''}><strong>[ TODAS AS ÁREAS ]</strong></label>`;
    allAreas.forEach(a => {
        const isChecked = checkedBoxes.includes(a) || (checkedBoxes.length === 0 && document.getElementById('check-all-area')?.checked) ? 'checked' : '';
        html += `<label class="checkbox-item"><input type="checkbox" class="bi-area-check" value="${a}" onchange="updateBIProjectFilter()" ${isChecked}>${a}</label>`;
    });
    container.innerHTML = html;
    updateBIProjectFilter(); 
}

function toggleAllAreas(masterCheckbox) { 
    document.querySelectorAll('.bi-area-check').forEach(cb => cb.checked = masterCheckbox.checked); 
    biSelectedUsers = []; 
    updateBIProjectFilter(); 
}

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
    const allowedProjects = [...new Set(allowedTasks.map(t => t.project))].sort((a, b) => a.localeCompare(b));
    let html = `<label class="checkbox-item"><input type="checkbox" id="check-all-proj" onchange="toggleAllProjects(this)" ${previouslyCheckedProjs.length === 0 || previouslyCheckedProjs.includes('ALL') ? 'checked' : ''}><strong>[ TODOS PERMITIDOS ]</strong></label>`;
    allowedProjects.forEach(p => {
        const isChecked = previouslyCheckedProjs.includes(p) || (previouslyCheckedProjs.length === 0 && document.getElementById('check-all-proj')?.checked) ? 'checked' : '';
        html += `<label class="checkbox-item"><input type="checkbox" class="bi-proj-check" value="${p}" onchange="triggerRenderNativeBI()" ${isChecked}>${p}</label>`;
    });
    container.innerHTML = html;
    biSelectedUsers = []; 
    renderNativeBI(); 
}

function toggleAllProjects(masterCheckbox) { 
    document.querySelectorAll('.bi-proj-check').forEach(cb => cb.checked = masterCheckbox.checked); 
    biSelectedUsers = []; 
    renderNativeBI(); 
}

function triggerRenderNativeBI() { biSelectedUsers = []; renderNativeBI(); }

function renderNativeBI() {
    const masterCheck = document.getElementById('check-all-proj');
    const checkboxes = Array.from(document.querySelectorAll('.bi-proj-check:checked')).map(cb => cb.value);
    const btnText = document.getElementById('btn-filter-proj');
    const selectedAreas = Array.from(document.querySelectorAll('.bi-area-check:checked')).map(cb => cb.value);
    const masterAreaCheck = document.getElementById('check-all-area');
    
    let baseTasks = currentUserRole === 'super-admin' ? allTasks : allTasks.filter(t => managedAreas.includes(t.area) || managedProjects.includes(t.project));
    if (!(masterAreaCheck && masterAreaCheck.checked)) { baseTasks = baseTasks.filter(t => selectedAreas.includes(t.area || 'Sem Área')); }

    if (masterCheck && masterCheck.checked) { btnText.innerText = "[ TODOS OS PROJETOS ] ▾"; } 
    else if (checkboxes.length > 0) { btnText.innerText = `${checkboxes.length} PROJETO(S) ▾`; baseTasks = baseTasks.filter(t => checkboxes.includes(t.project)); } 
    else { btnText.innerText = "NENHUM PROJETO ▾"; baseTasks = []; }

    const teamLoad = {};
    baseTasks.forEach(t => { 
        if(t.resps && t.resps.length > 0) { t.resps.forEach(r => { const rn = r.nome.split(' ')[0]; teamLoad[rn] = (teamLoad[rn] || 0) + 1; }); } 
        else { teamLoad['Sem Dono'] = (teamLoad['Sem Dono'] || 0) + 1; }
    });
    
    const barLabels = Object.keys(teamLoad).sort((a, b) => a.localeCompare(b));
    const barData = barLabels.map(l => teamLoad[l]);
    const bgColors = barLabels.map(l => {
        if (biSelectedUsers.length === 0) return '#0f172a'; 
        return biSelectedUsers.includes(l) ? '#0f172a' : '#cbd5e1';
    });

    if(biChartTeam) biChartTeam.destroy();
    biChartTeam = new Chart(document.getElementById('biTeamChart'), { 
        type: 'bar', data: { labels: barLabels, datasets: [{ label: 'Tarefas Atribuídas', data: barData, backgroundColor: bgColors, borderRadius: 4 }] }, 
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

    if (biSelectedUsers.length > 0) {
        currentFilteredTasks = baseTasks.filter(t => {
            if (biSelectedUsers.includes('Sem Dono') && (!t.resps || t.resps.length === 0)) return true;
            if (!t.resps) return false;
            return t.resps.some(r => biSelectedUsers.includes(r.nome.split(' ')[0]));
        });
    } else { currentFilteredTasks = baseTasks; }

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
    if (baseTasks.length > 0 && biSelectedUsers.length > 0) { influencePerc = Math.round((currentFilteredTasks.length / baseTasks.length) * 100); } 
    else if (baseTasks.length === 0) { influencePerc = 0; }
    document.getElementById('bi-kpi-influencia').innerText = influencePerc + '%';

    const pendentes = kpis.total - kpis.concluidas;
    if(biChartProgress) biChartProgress.destroy();
    biChartProgress = new Chart(document.getElementById('biProgressChart'), { 
        type: 'doughnut', data: { labels: ['Concluídas', 'Pendentes'], datasets: [{ data: [kpis.concluidas, pendentes], backgroundColor: ['#10b981', '#1e293b'] }] }, 
        options: { responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { tooltip: { callbacks: { label: function(c) { let v=c.parsed, t=c.dataset.data.reduce((a,b)=>a+b,0), p=t>0?Math.round((v/t)*100):0; return ` ${c.label}: ${v} (${p}%)`; }}}}} 
    });

    drawExecutiveGantt(currentFilteredTasks);
}

function drawExecutiveGantt(tasks) {
    const tbody = document.getElementById('bi-gantt-body');
    if(!tbody) return;
    tbody.innerHTML = '';
    const gTasks = tasks.filter(t => t.data_inicio && t.data_fim);
    if(gTasks.length === 0) { tbody.innerHTML = '<tr><td colspan="2" style="text-align:center; color:#888;">Nenhum cronograma definido.</td></tr>'; return; }

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
    let todayMarker = (todayPerc >= 0 && todayPerc <= 100) ? `<div class="gantt-today-marker" style="left: ${todayPerc}%;" title="Linha do Tempo: Hoje"></div>` : '';

    let html = '';
    gTasks.forEach(t => {
        const start = new Date(t.data_inicio + 'T00:00:00');
        const end = new Date(t.data_fim + 'T00:00:00');
        const leftPerc = ((start - minDate) / totalDuration) * 100;
        const widthPerc = Math.max(((end - start) / totalDuration) * 100, 2);
        
        const cStatus = getCalculatedStatus(t);
        const respNames = t.resps && t.resps.length > 0 ? t.resps.map(r => r.nome.split(' ')[0]).join(', ') : '-';
        const fStart = start.toLocaleDateString('pt-BR', {day: '2-digit', month: '2-digit', year:'numeric'});
        const fEnd = end.toLocaleDateString('pt-BR', {day: '2-digit', month: '2-digit', year:'numeric'});

        html += `<tr><td><strong style="font-size: 13px;">${t.text}</strong><br><small style="color:#64748b;">[${t.project}] • Resp: ${respNames}</small></td>
        <td><div class="gantt-track">${todayMarker}<div class="gantt-bar-fill ${cStatus.class}" style="left: ${leftPerc}%; width: ${widthPerc}%;" title="Início: ${fStart}&#10;Término: ${fEnd}&#10;Status: ${cStatus.label}"><span>📅 ${start.toLocaleDateString('pt-BR', {day: '2-digit', month: '2-digit'})} até ${end.toLocaleDateString('pt-BR', {day: '2-digit', month: '2-digit'})}</span></div></div></td></tr>`;
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
            return `<tr onclick="abrirModal('${t.id}')" style="cursor:pointer" title="Clique para editar a Demanda">
                <td style="font-size:11px; color:#666;">${t.area || '-'}</td>
                <td class="bold">${t.project}</td>
                <td>${t.text}</td>
                <td>${t.data_fim ? t.data_fim.split('-').reverse().join('/') : 'N/D'}</td>
                <td>${respNames}</td>
                <td><span class="status-pill ${cStatus.class}">${cStatus.label}</span></td>
            </tr>`;
        }).join('');
    }
    modal.classList.add('active');
}

function closeDrilldown() { document.getElementById('drilldownModal').classList.remove('active'); }