// ==========================================================================
// VARIÁVEIS GLOBAIS E ESTADO DO SISTEMA
// ==========================================================================
let allTasks = [];
let allUsers = []; 
let currentFilteredTasks = []; 
let currentTaskId = null;
let currentUserEmail = null; 
let currentUserRole = null; 
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
    
    const navBtnId = sec === 'dashboard-bi' ? 'btn-nav-bi' : (sec === 'acompanhamento' ? 'btn-nav-op' : `btn-nav-${sec}`);
    if(document.getElementById(navBtnId)) document.getElementById(navBtnId).classList.add('active');

    if(sec === 'usuarios') renderUsers();
}

function updateNavVisibility() {
    const isSuperAdmin = currentUserRole === 'super-admin';
    const isGestor = managedProjects.length > 0;
    
    document.getElementById('btn-nav-bi').style.display = (isSuperAdmin || isGestor) ? 'inline-block' : 'none';
    document.getElementById('btn-nav-novo').style.display = (isSuperAdmin || isGestor) ? 'inline-block' : 'none';
    document.getElementById('btn-nav-usuarios').style.display = isSuperAdmin ? 'inline-block' : 'none';
    
    const currentActive = document.querySelector('.content-section.active')?.id;
    if (!isSuperAdmin && !isGestor && (currentActive === 'sec-dashboard-bi' || currentActive === 'sec-novo-projeto')) {
        showSection('acompanhamento');
    }
}

// ==========================================================================
// 2. AUTENTICAÇÃO
// ==========================================================================
auth.onAuthStateChanged(async user => {
    if (user) {
        currentUserEmail = user.email.toLowerCase();
        const userQuery = await db.collection('usuarios').where('email', '==', currentUserEmail).get();
        if (userQuery.empty) { alert("Acesso Negado. Você não está credenciado."); auth.signOut(); return; }
        
        const userData = userQuery.docs[0].data();
        currentUserRole = userData.papel || 'membro'; 
        
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('app-screen').style.display = 'block';
        document.getElementById('saudacao').innerText = `Olá, ${userData.nome.split(' ')[0]}`;
        
        loadUsersDatabase();
        loadData(); 
    } else {
        document.getElementById('login-screen').style.display = 'flex';
        document.getElementById('app-screen').style.display = 'none';
    }
});

function logout() { auth.signOut(); }
document.getElementById('login-btn').onclick = () => auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());

// ==========================================================================
// 3. CARGA DE DADOS
// ==========================================================================
function loadData() {
    db.collection('tarefas').orderBy('criadoEm', 'desc').onSnapshot(snapshot => {
        allTasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        if (currentUserRole === 'super-admin') {
            managedProjects = [...new Set(allTasks.map(t => t.project))];
        } else {
            managedProjects = [...new Set(allTasks.filter(t => t.resps && t.resps.some(r => r.email === currentUserEmail && r.papel === 'gestor')).map(t => t.project))];
        }

        updateNavVisibility();
        updateProjectList();
        renderDashboard(); // O renderDashboard agora aciona o renderBoard automaticamente
        updateBIProjectFilter(); 
        renderNativeBI();
    });
}

function loadUsersDatabase() {
    db.collection('usuarios').onSnapshot(snapshot => {
        allUsers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        populateUserSelects();
        renderUsers();
    });
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
        alert("Membro credenciado com sucesso!");
    } else {
        alert("Preencha nome e e-mail.");
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
// 5. INCLUSÃO DE DEMANDAS
// ==========================================================================
function populateUserSelects() {
    const selects = document.querySelectorAll('.resp-select');
    const optionsHTML = '<option value="">Selecione...</option>' + allUsers.map(u => `<option value="${u.email}">${u.nome}</option>`).join('');
    selects.forEach(sel => {
        const currentVal = sel.value;
        sel.innerHTML = optionsHTML;
        sel.value = currentVal;
    });
}

function addResponsavelField() {
    const container = document.getElementById('responsaveis-container');
    const div = document.createElement('div');
    div.className = 'resp-row';
    div.style = "display: flex; gap: 10px; margin-bottom: 10px;";
    div.innerHTML = `
        <select class="resp-select" style="flex: 2;">${document.querySelector('.resp-select').innerHTML}</select>
        <select class="resp-role" style="flex: 1;">
            <option value="executor">Executor</option>
            <option value="gestor">Gestor do Projeto</option>
        </select>
    `;
    container.appendChild(div);
}

async function saveDemand() {
    const project = document.getElementById('projectInput').value.trim();
    const title = document.getElementById('taskTitle').value.trim();
    const desc = document.getElementById('taskDesc').value.trim();
    const dateStart = document.getElementById('dateInputStart').value;
    const dateEnd = document.getElementById('dateInputEnd').value;
    
    if (currentUserRole !== 'super-admin' && !managedProjects.includes(project)) {
        alert("Acesso Negado: Você só pode adicionar tarefas aos projetos em que é Gestor.");
        return;
    }

    const resps = [];
    document.querySelectorAll('.resp-row').forEach(row => {
        const email = row.querySelector('.resp-select').value;
        const papel = row.querySelector('.resp-role').value;
        if(email) {
            const userObj = allUsers.find(u => u.email === email);
            if(userObj && !resps.find(r => r.email === userObj.email)) {
                resps.push({ nome: userObj.nome, email: userObj.email, papel: papel });
            }
        }
    });
    
    if(!project || !title || resps.length === 0 || !dateStart || !dateEnd) {
        return alert("Preencha Projeto, Título, Datas e pelo menos um Responsável.");
    }
    
    try {
        await db.collection('tarefas').add({
            project, text: title, descricao: desc,
            data_inicio: dateStart, data_fim: dateEnd,
            status: 'fazer', perc_desenvolvimento: 0, resps, criadoEm: new Date(), historico: [], email: resps[0].email
        });

        for (const r of resps) {
            try {
                await emailjs.send("service_yw91uty", "template_p5wyzq8", {
                    responsavel: r.nome,
                    projeto: project,
                    email_to: r.email 
                });
            } catch (error) {
                console.error(`Falha ao notificar ${r.nome}:`, error);
            }
        }
        
        alert("Demanda lançada e equipe notificada com sucesso!");
        document.getElementById('taskTitle').value = '';
        document.getElementById('taskDesc').value = '';
        showSection('acompanhamento');
    } catch (e) {
        console.error("Erro fatal ao salvar demanda:", e);
        alert("Erro ao lançar a demanda.");
    }
}

// ==========================================================================
// 6. VISÃO OPERACIONAL E MODAIS (Totalmente Refatorada)
// ==========================================================================
function getVisibleTasksBoard() {
    if (currentUserRole === 'super-admin') return allTasks;
    return allTasks.filter(t => managedProjects.includes(t.project) || (t.resps && t.resps.some(r => r.email === currentUserEmail)));
}

function updateProjectList() {
    const datalist = document.getElementById('projectsList');
    if(datalist) datalist.innerHTML = managedProjects.map(p => `<option value="${p}">`).join(''); 

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
    
    document.getElementById('stats-grid').innerHTML = `
        <div class="stat-card shadow"><h3>${stats.total}</h3><p>Demandas</p></div>
        <div class="stat-card shadow" style="border-left:4px solid #dc3545"><h3>${stats.atrasadas}</h3><p>Atrasadas</p></div>
        <div class="stat-card shadow" style="border-left:4px solid #000"><h3>${stats.pendentes}</h3><p>Em Aprovação</p></div>
        <div class="stat-card shadow" style="border-left:4px solid #28a745"><h3>${stats.concluidas}</h3><p>Concluídas</p></div>`;

    // O filtro agora força a atualização da tabela abaixo também
    renderBoard();
}

function renderBoard() {
    const board = document.getElementById('projectsBoard');
    const tasks = getVisibleTasksBoard();
    const selected = document.getElementById('filterProject').value;
    const filtered = selected === 'geral' ? tasks : tasks.filter(t => t.project === selected);
    
    if (filtered.length === 0) {
        board.innerHTML = '<p style="padding: 30px; text-align: center; color: #888; font-weight: bold;">Nenhuma demanda encontrada para este filtro.</p>';
        return;
    }

    // Engenharia de Agrupamento por Projeto
    const grouped = {};
    filtered.forEach(t => {
        if (!grouped[t.project]) grouped[t.project] = [];
        grouped[t.project].push(t);
    });

    let html = '';
    
    Object.keys(grouped).sort().forEach(projName => {
        // Cabeçalho do Projeto
        html += `<div style="background: #f8fafc; padding: 12px 20px; border-bottom: 1px solid var(--border-color); margin-top: 15px;">
                    <h4 style="margin: 0; font-size: 13px; text-transform: uppercase; color: #0f172a; letter-spacing: 0.5px;">📁 ${projName}</h4>
                 </div>`;
        
        // Tabela das Tarefas daquele projeto
        html += `<table style="margin-bottom: 0;">
                    <thead><tr>
                        <th style="width:40%">Tarefa</th>
                        <th style="width:20%">Prazo</th>
                        <th style="width:20%">Responsável</th>
                        <th style="width:20%">Status</th>
                    </tr></thead>
                    <tbody>`;
        
        grouped[projName].forEach(t => {
            const sClass = `status-${t.status === 'concluido' ? 'concluido' : (t.status === 'aprovacao' ? 'andamento' : 'fazer')}`;
            const respName = t.resps && t.resps[0] ? t.resps[0].nome.split(' ')[0] : '-';
            html += `<tr onclick="abrirModal('${t.id}')" style="cursor:pointer">
                <td class="bold">${t.text}</td>
                <td>${t.data_fim ? t.data_fim.split('-').reverse().join('/') : 'N/D'}</td>
                <td>${respName}</td>
                <td><span class="status-pill ${sClass}">${t.status.toUpperCase()}</span></td>
            </tr>`;
        });
        html += `</tbody></table>`;
    });

    board.innerHTML = html;
}

function abrirModal(id) {
    currentTaskId = id;
    const t = allTasks.find(x => x.id === id);
    document.getElementById('taskModal').classList.add('active');
    
    const isProjectGestor = currentUserRole === 'super-admin' || managedProjects.includes(t.project);
    
    document.getElementById('editTitle').value = t.text;
    document.getElementById('editTitle').disabled = !isProjectGestor;
    document.getElementById('editDateStart').value = t.data_inicio || "";
    document.getElementById('editDateStart').disabled = !isProjectGestor;
    document.getElementById('editDateEnd').value = t.data_fim || "";
    document.getElementById('editDateEnd').disabled = !isProjectGestor;
    document.getElementById('editDesc').value = t.descricao || "";
    document.getElementById('editPerc').value = t.perc_desenvolvimento || 0;
    document.getElementById('editStatus').value = t.status;
    
    document.getElementById('opt-concluido').style.display = isProjectGestor ? 'block' : 'none';
    document.getElementById('btn-delete-task').style.display = isProjectGestor ? 'inline-block' : 'none';
    
    const hist = document.getElementById('modalHistorico');
    hist.innerHTML = (t.historico && t.historico.length > 0) ? t.historico.map(h => `<div class="history-item"><strong>${h.autor.split('@')[0]}</strong> <small>${h.data}</small><br>${h.texto}</div>`).join('') : "<em>Sem reportes.</em>";
}

function closeModal() { document.getElementById('taskModal').classList.remove('active'); }

document.addEventListener('keydown', (e) => { 
    if(e.key === "Escape") {
        closeModal();
        if (typeof closeDrilldown === "function") closeDrilldown();
    } 
});

async function saveModalChanges() {
    const t = allTasks.find(x => x.id === currentTaskId);
    const isProjectGestor = currentUserRole === 'super-admin' || managedProjects.includes(t.project);
    const report = document.getElementById('newReport').value.trim();
    
    const update = { 
        status: document.getElementById('editStatus').value, 
        perc_desenvolvimento: parseInt(document.getElementById('editPerc').value) || 0 
    };
    
    if(isProjectGestor) {
        update.text = document.getElementById('editTitle').value;
        update.data_inicio = document.getElementById('editDateStart').value;
        update.data_fim = document.getElementById('editDateEnd').value;
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

        // DISPARO DE E-MAIL (CC UNIVERSAL PARA SUPER-ADMIN)
        if (hasMeaningfulChange) {
            let recipientsEmails = (t.resps || []).map(r => r.email);
            
            // Força a entrada de todos os Super-Admins na lista de aviso
            const superAdmins = allUsers.filter(u => u.papel === 'super-admin').map(u => u.email);
            recipientsEmails = [...new Set([...recipientsEmails, ...superAdmins])];
            
            // Remove a pessoa que fez a alteração para não receber o próprio e-mail
            recipientsEmails = recipientsEmails.filter(email => email !== currentUserEmail);

            for (const emailTo of recipientsEmails) {
                try {
                    await emailjs.send("service_yw91uty", "template_dexwd15", {
                        projeto: t.project,
                        tarefa: update.text || t.text,
                        autor_atualizacao: currentUserEmail,
                        novo_status: update.status.toUpperCase(),
                        progresso: update.perc_desenvolvimento,
                        reporte: report || systemMsg,
                        email_to: emailTo
                    });
                } catch (error) {
                    console.error(`Falha no envio de atualização para ${emailTo}:`, error);
                }
            }
        }

        document.getElementById('newReport').value = "";
        closeModal();
    } catch (e) {
        console.error("Erro na atualização:", e);
        alert("Falha de comunicação com o servidor.");
    }
}

async function deleteTask() { if(confirm("Excluir definitivamente?")) { await db.collection('tarefas').doc(currentTaskId).delete(); closeModal(); } }

// ==========================================================================
// 7. BUSINESS INTELLIGENCE
// ==========================================================================
function toggleFilterMenu() { document.getElementById('filter-checkboxes').classList.toggle('show'); }
window.onclick = function(e) { if (!e.target.matches('.dropdown-btn') && !e.target.closest('.dropdown-content')) { document.querySelectorAll('.dropdown-content.show').forEach(el => el.classList.remove('show')); } }

function updateBIProjectFilter() {
    const container = document.getElementById('filter-checkboxes');
    if(!container) return;
    
    const checkedBoxes = Array.from(document.querySelectorAll('.bi-proj-check:checked')).map(cb => cb.value);
    
    const allowedProjects = currentUserRole === 'super-admin' ? [...new Set(allTasks.map(t => t.project))] : managedProjects;
    allowedProjects.sort();
    
    let html = `<label class="checkbox-item"><input type="checkbox" id="check-all-proj" onchange="toggleAllProjects(this)" ${checkedBoxes.length === 0 || checkedBoxes.includes('ALL') ? 'checked' : ''}><strong>[ TODOS PERMITIDOS ]</strong></label>`;
    allowedProjects.forEach(p => {
        const isChecked = checkedBoxes.includes(p) || (checkedBoxes.length === 0 && document.getElementById('check-all-proj')?.checked) ? 'checked' : '';
        html += `<label class="checkbox-item"><input type="checkbox" class="bi-proj-check" value="${p}" onchange="renderNativeBI()" ${isChecked}>${p}</label>`;
    });
    container.innerHTML = html;
}

function toggleAllProjects(masterCheckbox) {
    document.querySelectorAll('.bi-proj-check').forEach(cb => cb.checked = masterCheckbox.checked);
    renderNativeBI();
}

function renderNativeBI() {
    const masterCheck = document.getElementById('check-all-proj');
    const checkboxes = Array.from(document.querySelectorAll('.bi-proj-check:checked')).map(cb => cb.value);
    const btnText = document.getElementById('btn-filter-toggle');
    
    const baseTasks = currentUserRole === 'super-admin' ? allTasks : allTasks.filter(t => managedProjects.includes(t.project));

    if (masterCheck && masterCheck.checked) {
        btnText.innerText = "[ TODOS OS PROJETOS ] ▾";
        currentFilteredTasks = baseTasks;
    } else if (checkboxes.length > 0) {
        btnText.innerText = `${checkboxes.length} PROJETO(S) ▾`;
        currentFilteredTasks = baseTasks.filter(t => checkboxes.includes(t.project));
    } else {
        btnText.innerText = "NENHUM PROJETO ▾";
        currentFilteredTasks = [];
    }

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
        type: 'doughnut', 
        data: { labels: ['Concluído', 'Pendente'], datasets: [{ data: [concluidas, pendentes], backgroundColor: ['#10b981', '#1e293b'] }] }, 
        options: { 
            responsive: true, maintainAspectRatio: false, cutout: '65%',
            plugins: { tooltip: { callbacks: { label: function(context) {
                let val = context.parsed; let total = context.dataset.data.reduce((a, b) => a + b, 0); let perc = total > 0 ? Math.round((val / total) * 100) : 0;
                return ` ${context.label}: ${val} tarefa(s) (${perc}%)`;
            }}}}
        } 
    });

    const teamLoad = {};
    currentFilteredTasks.forEach(t => { const resp = t.resps && t.resps[0] ? t.resps[0].nome.split(' ')[0] : 'Sem Dono'; teamLoad[resp] = (teamLoad[resp] || 0) + 1; });
    
    if(biChartTeam) biChartTeam.destroy();
    biChartTeam = new Chart(document.getElementById('biTeamChart'), { 
        type: 'bar', 
        data: { labels: Object.keys(teamLoad), datasets: [{ label: 'Tarefas Atribuídas', data: Object.values(teamLoad), backgroundColor: '#0f172a', borderRadius: 4 }] }, 
        options: { responsive: true, maintainAspectRatio: false } 
    });

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

    let html = '';
    gTasks.forEach(t => {
        const start = new Date(t.data_inicio + 'T00:00:00');
        const end = new Date(t.data_fim + 'T00:00:00');
        const leftPerc = ((start - minDate) / totalDuration) * 100;
        const widthPerc = Math.max(((end - start) / totalDuration) * 100, 2);
        const barClass = t.status === 'concluido' ? 'concluido' : (end < (new Date().setHours(0,0,0,0)) ? 'atrasado' : '');
        const respName = t.resps && t.resps[0] ? t.resps[0].nome.split(' ')[0] : '-';

        html += `<tr><td><strong style="font-size: 13px;">${t.text}</strong><br><small style="color:#64748b;">[${t.project}] • Resp: ${respName}</small></td>
        <td><div class="gantt-track"><div class="gantt-bar-fill ${barClass}" style="left: ${leftPerc}%; width: ${widthPerc}%;"><span>📅 ${start.toLocaleDateString('pt-BR', {day: '2-digit', month: '2-digit'})} até ${end.toLocaleDateString('pt-BR', {day: '2-digit', month: '2-digit'})} • ${t.perc_desenvolvimento || 0}%</span></div></div></td></tr>`;
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

    if (targetTasks.length === 0) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Nenhuma tarefa encontrada.</td></tr>'; }
    else {
        tbody.innerHTML = targetTasks.map(t => {
            const resp = t.resps && t.resps[0] ? t.resps[0].nome : 'Sem Responsável';
            const sClass = `status-${t.status === 'concluido' ? 'concluido' : (t.status === 'aprovacao' ? 'andamento' : 'fazer')}`;
            return `<tr><td class="bold">${t.project}</td><td>${t.text}</td><td>${t.data_fim ? t.data_fim.split('-').reverse().join('/') : 'N/D'}</td><td>${resp}</td><td><span class="status-pill ${sClass}">${t.status.toUpperCase()}</span></td></tr>`;
        }).join('');
    }
    modal.classList.add('active');
}

function closeDrilldown() { document.getElementById('drilldownModal').classList.remove('active'); }