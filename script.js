const LOOKER_STUDIO_EMBED_URL = "https://lookerstudio.google.com/embed/reporting/ed770545-0285-4838-8911-3c3bf86123b2/page/JZjsF"; 

let allTasks = [];
let allUsers = []; 
let currentTaskId = null;
let currentUserEmail = null; 
let currentUserRole = null; 

// NAVEGAÇÃO
function showSection(sec) {
    document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-link').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`sec-${sec}`).classList.add('active');
    
    const navBtnId = sec === 'dashboard-bi' ? 'btn-nav-bi' : (sec === 'acompanhamento' ? 'btn-nav-op' : `btn-nav-${sec}`);
    if(document.getElementById(navBtnId)) document.getElementById(navBtnId).classList.add('active');

    if(sec === 'usuarios') renderUsers();
    if(sec === 'dashboard-bi') initializeBI();
}

// LOGIN / AUTH
auth.onAuthStateChanged(async user => {
    if (user) {
        currentUserEmail = user.email.toLowerCase();
        const userQuery = await db.collection('usuarios').where('email', '==', currentUserEmail).get();
        if (userQuery.empty) { alert("Acesso Negado."); auth.signOut(); return; }
        
        const userData = userQuery.docs[0].data();
        currentUserRole = userData.papel;
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('app-screen').style.display = 'block';
        document.getElementById('saudacao').innerText = `Olá, ${userData.nome.split(' ')[0]} (${currentUserRole.toUpperCase()})`;
        
        const isAdm = (currentUserRole === 'super-admin' || currentUserRole === 'gestor');
        document.getElementById('btn-nav-novo').style.display = isAdm ? 'inline-block' : 'none';
        document.getElementById('btn-nav-usuarios').style.display = (currentUserRole === 'super-admin') ? 'inline-block' : 'none';
        
        loadData();
        loadUsersDatabase();
        showSection('dashboard-bi');
    } else {
        document.getElementById('login-screen').style.display = 'flex';
        document.getElementById('app-screen').style.display = 'none';
    }
});

function logout() { auth.signOut(); }
document.getElementById('login-btn').onclick = () => auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());


// DADOS
function loadData() {
    db.collection('tarefas').orderBy('criadoEm', 'desc').onSnapshot(snapshot => {
        allTasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        updateProjectList();
        renderDashboard();
        renderBoard();
        
        // AS DUAS LINHAS NOVAS QUE INICIAM O BI:
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

// EQUIPE
function populateUserSelects() {
    const selects = document.querySelectorAll('.resp-select');
    const optionsHTML = '<option value="">Selecione...</option>' + allUsers.map(u => `<option value="${u.email}">${u.nome}</option>`).join('');
    selects.forEach(sel => sel.innerHTML = optionsHTML);
}

function addResponsavelField() {
    const container = document.getElementById('responsaveis-container');
    const div = document.createElement('div');
    div.className = 'resp-row';
    div.innerHTML = `<select class="resp-select" style="margin-top:5px;">${document.querySelector('.resp-select').innerHTML}</select>`;
    container.appendChild(div);
}

function renderUsers() {
    const board = document.getElementById('lista-usuarios-board');
    if(!board) return;
    let html = `<div class="table-container shadow"><table><thead><tr><th>Nome</th><th>E-mail</th><th>Acesso</th><th style="text-align:right">Ação</th></tr></thead><tbody>`;
    allUsers.forEach(u => {
        html += `<tr><td class="bold">${u.nome}</td><td>${u.email}</td><td><span class="status-pill status-fazer">${u.papel}</span></td><td style="text-align:right">
        ${u.email !== currentUserEmail ? `<button onclick="removerUsuario('${u.id}')" class="btn-danger">REMOVER</button>` : '<small>(Você)</small>'}</td></tr>`;
    });
    board.innerHTML = html + `</tbody></table></div>`;
}

async function removerUsuario(id) { if(confirm("Revogar acesso?")) await db.collection('usuarios').doc(id).delete(); }
async function cadastrarUsuario() {
    const nome = document.getElementById('novoUserNome').value;
    const email = document.getElementById('novoUserEmail').value.toLowerCase();
    const papel = document.getElementById('novoUserPapel').value;
    if(nome && email) await db.collection('usuarios').add({ nome, email, papel });
}

// OPERACIONAL
function updateProjectList() {
    const filter = document.getElementById('filterProject');
    const projects = [...new Set(allTasks.map(t => t.project))].sort();
    filter.innerHTML = '<option value="geral">Todos os Projetos</option>' + projects.map(p => `<option value="${p}">${p}</option>`).join('');
}

function renderDashboard() {
    const selected = document.getElementById('filterProject').value;
    const filtered = selected === 'geral' ? allTasks : allTasks.filter(t => t.project === selected);
    const stats = {
        total: filtered.length,
        atrasadas: filtered.filter(t => t.status !== 'concluido' && t.data_fim && new Date(t.data_fim) < new Date()).length,
        pendentes: filtered.filter(t => t.status === 'aprovacao').length,
        concluidas: filtered.filter(t => t.status === 'concluido').length
    };
    document.getElementById('stats-grid').innerHTML = `
        <div class="stat-card"><h3>${stats.total}</h3><p>Demandas</p></div>
        <div class="stat-card" style="border-left:4px solid #dc3545"><h3>${stats.atrasadas}</h3><p>Atrasadas</p></div>
        <div class="stat-card" style="border-left:4px solid #000"><h3>${stats.pendentes}</h3><p>Em Aprovação</p></div>
        <div class="stat-card" style="border-left:4px solid #28a745"><h3>${stats.concluidas}</h3><p>Concluídas</p></div>`;
}

function renderBoard() {
    const board = document.getElementById('projectsBoard');
    const selected = document.getElementById('filterProject').value;
    const filtered = (selected === 'geral' ? allTasks : allTasks.filter(t => t.project === selected)).filter(t => (currentUserRole === 'super-admin' || currentUserRole === 'gestor') || t.resps.some(r => r.email === currentUserEmail));
    
    let html = `<table><thead><tr><th>Projeto</th><th>Tarefa</th><th>Prazo</th><th>Status</th></tr></thead><tbody>`;
    filtered.forEach(t => {
        const sClass = `status-${t.status === 'concluido' ? 'concluido' : (t.status === 'aprovacao' ? 'andamento' : 'fazer')}`;
        html += `<tr onclick="abrirModal('${t.id}')" style="cursor:pointer"><td class="bold">${t.project}</td><td>${t.text}</td><td>${t.data_fim || 'N/D'}</td><td><span class="status-pill ${sClass}">${t.status}</span></td></tr>`;
    });
    board.innerHTML = html + `</tbody></table>`;
}

// MODAL & ESC
function abrirModal(id) {
    currentTaskId = id;
    const t = allTasks.find(x => x.id === id);
    document.getElementById('taskModal').classList.add('active');
    const isAdm = (currentUserRole === 'super-admin' || currentUserRole === 'gestor');
    
    document.getElementById('editTitle').value = t.text;
    document.getElementById('editDateStart').value = t.data_inicio || "";
    document.getElementById('editDateEnd').value = t.data_fim || "";
    document.getElementById('editDesc').value = t.descricao || "";
    document.getElementById('editPerc').value = t.perc_desenvolvimento || 0;
    document.getElementById('editStatus').value = t.status;
    document.getElementById('opt-concluido').style.display = isAdm ? 'block' : 'none';
    
    const hist = document.getElementById('modalHistorico');
    hist.innerHTML = (t.historico && t.historico.length > 0) ? t.historico.map(h => `<div class="history-item"><strong>${h.autor.split('@')[0]}</strong> <small>${h.data}</small><br>${h.texto}</div>`).join('') : "<em>Sem reportes.</em>";
    document.getElementById('btn-delete-task').style.display = isAdm ? 'inline-block' : 'none';
}

function closeModal() { document.getElementById('taskModal').classList.remove('active'); }
document.addEventListener('keydown', (e) => { if(e.key === "Escape") closeModal(); });

async function saveModalChanges() {
    const report = document.getElementById('newReport').value.trim();
    const update = { 
        status: document.getElementById('editStatus').value, 
        perc_desenvolvimento: parseInt(document.getElementById('editPerc').value) || 0 
    };
    if(currentUserRole === 'super-admin' || currentUserRole === 'gestor') {
        update.text = document.getElementById('editTitle').value;
        update.data_inicio = document.getElementById('editDateStart').value;
        update.data_fim = document.getElementById('editDateEnd').value;
    }
    if(report) {
        update.historico = firebase.firestore.FieldValue.arrayUnion({ data: new Date().toLocaleString('pt-BR'), autor: currentUserEmail, texto: report });
    }
    await db.collection('tarefas').doc(currentTaskId).update(update);
    document.getElementById('newReport').value = "";
    closeModal();
}

async function saveDemand() {
    const project = document.getElementById('projectInput').value;
    const title = document.getElementById('taskTitle').value;
    const resps = Array.from(document.querySelectorAll('.resp-select')).map(s => ({ email: s.value, nome: allUsers.find(u => u.email === s.value)?.nome })).filter(r => r.email);
    
    if(!project || !title || resps.length === 0) return alert("Dados incompletos.");
    
    await db.collection('tarefas').add({
        project, text: title, descricao: document.getElementById('taskDesc').value,
        data_inicio: document.getElementById('dateInputStart').value, data_fim: document.getElementById('dateInputEnd').value,
        status: 'fazer', perc_desenvolvimento: 0, resps, criadoEm: new Date(), historico: [], email: resps[0].email
    });
    showSection('acompanhamento');
}

async function deleteTask() { if(confirm("Excluir?")) { await db.collection('tarefas').doc(currentTaskId).delete(); closeModal(); } }
// ==========================================================================
// BUSINESS INTELLIGENCE NATIVO (V5.2)
// ==========================================================================
// ==========================================================================
// BUSINESS INTELLIGENCE NATIVO (V5.3 - EXECUTIVE)
// ==========================================================================
let biChartProgress = null;
let biChartTeam = null;
let currentFilteredTasks = []; // Guarda as tarefas filtradas para o Drilldown

// 1. LÓGICA DO FILTRO SUSPENSO
function toggleFilterMenu() {
    document.getElementById('filter-checkboxes').classList.toggle('show');
}

// Fecha o menu se clicar fora
window.onclick = function(event) {
    if (!event.target.matches('.dropdown-btn') && !event.target.closest('.dropdown-content')) {
        const dropdowns = document.getElementsByClassName("dropdown-content");
        for (let i = 0; i < dropdowns.length; i++) {
            if (dropdowns[i].classList.contains('show')) dropdowns[i].classList.remove('show');
        }
    }
}

function updateBIProjectFilter() {
    const container = document.getElementById('filter-checkboxes');
    if(!container) return;
    
    // Pega as opções selecionadas atualmente
    const checkedBoxes = Array.from(document.querySelectorAll('.bi-proj-check:checked')).map(cb => cb.value);
    const projects = [...new Set(allTasks.map(t => t.project))].sort();
    
    let html = `
        <label class="checkbox-item">
            <input type="checkbox" id="check-all-proj" onchange="toggleAllProjects(this)" ${checkedBoxes.length === 0 || checkedBoxes.includes('ALL') ? 'checked' : ''}>
            <strong>[ TODOS OS PROJETOS ]</strong>
        </label>
    `;
    
    projects.forEach(p => {
        const isChecked = checkedBoxes.includes(p) || (checkedBoxes.length === 0 && document.getElementById('check-all-proj')?.checked) ? 'checked' : '';
        html += `
            <label class="checkbox-item">
                <input type="checkbox" class="bi-proj-check" value="${p}" onchange="renderNativeBI()" ${isChecked}>
                ${p}
            </label>
        `;
    });
    
    container.innerHTML = html;
}

function toggleAllProjects(masterCheckbox) {
    const checkboxes = document.querySelectorAll('.bi-proj-check');
    checkboxes.forEach(cb => cb.checked = masterCheckbox.checked);
    renderNativeBI();
}

function renderNativeBI() {
    const masterCheck = document.getElementById('check-all-proj');
    const checkboxes = Array.from(document.querySelectorAll('.bi-proj-check:checked')).map(cb => cb.value);
    
    // Atualiza o texto do botão
    const btnText = document.getElementById('btn-filter-toggle');
    if (masterCheck && masterCheck.checked) {
        btnText.innerText = "[ TODOS OS PROJETOS ] ▾";
        currentFilteredTasks = allTasks;
    } else if (checkboxes.length > 0) {
        btnText.innerText = `${checkboxes.length} PROJETO(S) SELECIONADO(S) ▾`;
        currentFilteredTasks = allTasks.filter(t => checkboxes.includes(t.project));
    } else {
        btnText.innerText = "NENHUM PROJETO ▾";
        currentFilteredTasks = [];
    }

    // CÁLCULO DE KPIs
    const today = new Date();
    today.setHours(0,0,0,0);
    
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

    // GRÁFICO: Progresso (COM PERCENTUAL)
    const concluidas = currentFilteredTasks.filter(t => t.status === 'concluido').length;
    const pendentes = kpis.total - concluidas;

    if(biChartProgress) biChartProgress.destroy();
    biChartProgress = new Chart(document.getElementById('biProgressChart'), {
        type: 'doughnut',
        data: {
            labels: ['Concluído', 'Pendente'],
            datasets: [{ data: [concluidas, pendentes], backgroundColor: ['#10b981', '#1e293b'] }]
        },
        options: { 
            responsive: true, maintainAspectRatio: false, cutout: '65%',
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let val = context.parsed;
                            let total = context.dataset.data.reduce((a, b) => a + b, 0);
                            let perc = total > 0 ? Math.round((val / total) * 100) : 0;
                            return ` ${context.label}: ${val} tarefa(s) (${perc}%)`;
                        }
                    }
                }
            }
        }
    });

    // GRÁFICO: Carga da Equipe
    const teamLoad = {};
    currentFilteredTasks.forEach(t => {
        const resp = t.resps && t.resps[0] ? t.resps[0].nome.split(' ')[0] : 'Sem Dono';
        teamLoad[resp] = (teamLoad[resp] || 0) + 1;
    });

    if(biChartTeam) biChartTeam.destroy();
    biChartTeam = new Chart(document.getElementById('biTeamChart'), {
        type: 'bar',
        data: {
            labels: Object.keys(teamLoad),
            datasets: [{ label: 'Tarefas Atribuídas', data: Object.values(teamLoad), backgroundColor: '#0f172a', borderRadius: 4 }]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });

    // GERAÇÃO DO GANTT EXECUTIVO
    drawExecutiveGantt(currentFilteredTasks);
}

// 2. O NOVO GANTT EM FORMATO DE TABELA
function drawExecutiveGantt(tasks) {
    const tbody = document.getElementById('bi-gantt-body');
    tbody.innerHTML = '';

    const gTasks = tasks.filter(t => t.data_inicio && t.data_fim);
    if(gTasks.length === 0) {
        tbody.innerHTML = '<tr><td colspan="2" style="text-align:center; color:#888;">Nenhum cronograma definido para esta seleção.</td></tr>';
        return;
    }

    let minDate = new Date(Math.min(...gTasks.map(t => new Date(t.data_inicio + 'T00:00:00'))));
    let maxDate = new Date(Math.max(...gTasks.map(t => new Date(t.data_fim + 'T00:00:00'))));
    minDate.setDate(minDate.getDate() - 1); // Margem visual
    maxDate.setDate(maxDate.getDate() + 1);
    const totalDuration = maxDate - minDate;

    let html = '';
    gTasks.forEach(t => {
        const start = new Date(t.data_inicio + 'T00:00:00');
        const end = new Date(t.data_fim + 'T00:00:00');
        const today = new Date(); today.setHours(0,0,0,0);

        const leftPerc = ((start - minDate) / totalDuration) * 100;
        const widthPerc = Math.max(((end - start) / totalDuration) * 100, 2);

        let barClass = '';
        if(t.status === 'concluido') barClass = 'concluido';
        else if(end < today) barClass = 'atrasado';

        // Formatação de data visual BR
        const fStart = start.toLocaleDateString('pt-BR', {day: '2-digit', month: '2-digit'});
        const fEnd = end.toLocaleDateString('pt-BR', {day: '2-digit', month: '2-digit'});
        const respName = t.resps && t.resps[0] ? t.resps[0].nome.split(' ')[0] : '-';

        html += `
            <tr>
                <td>
                    <strong style="font-size: 13px;">${t.text}</strong><br>
                    <small style="color:#64748b;">[${t.project}] • Resp: ${respName}</small>
                </td>
                <td>
                    <div class="gantt-track">
                        <div class="gantt-bar-fill ${barClass}" style="left: ${leftPerc}%; width: ${widthPerc}%;">
                            <span>📅 ${fStart} até ${fEnd} • ${t.perc_desenvolvimento || 0}%</span>
                        </div>
                    </div>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = html;
}

// 3. LÓGICA DE DRILL-DOWN (RAIO-X DOS KPIs)
function openDrilldown(type) {
    const modal = document.getElementById('drilldownModal');
    const tbody = document.getElementById('drilldownBody');
    const title = document.getElementById('drilldownTitle');
    
    let targetTasks = [];
    const today = new Date(); today.setHours(0,0,0,0);

    if (type === 'total') {
        title.innerText = "Detalhamento: Total de Demandas";
        targetTasks = currentFilteredTasks;
    } else if (type === 'nao_iniciada') {
        title.innerText = "Detalhamento: Demandas Não Iniciadas (Com Atraso no Start)";
        targetTasks = currentFilteredTasks.filter(t => t.data_inicio && new Date(t.data_inicio + 'T00:00:00') < today && t.status === 'fazer');
    } else if (type === 'execucao') {
        title.innerText = "Detalhamento: Demandas Em Execução";
        targetTasks = currentFilteredTasks.filter(t => t.data_inicio && new Date(t.data_inicio + 'T00:00:00') <= today && t.status !== 'fazer');
    } else if (type === 'atraso') {
        title.innerText = "Detalhamento: Demandas com Prazo Vencido";
        targetTasks = currentFilteredTasks.filter(t => t.data_fim && new Date(t.data_fim + 'T00:00:00') < today && t.status !== 'concluido');
    }

    if (targetTasks.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Nenhuma tarefa encontrada neste recorte.</td></tr>';
    } else {
        tbody.innerHTML = targetTasks.map(t => {
            const resp = t.resps && t.resps[0] ? t.resps[0].nome : 'Sem Responsável';
            const sClass = `status-${t.status === 'concluido' ? 'concluido' : (t.status === 'aprovacao' ? 'andamento' : 'fazer')}`;
            return `
                <tr>
                    <td class="bold">${t.project}</td>
                    <td>${t.text}</td>
                    <td>${t.data_fim ? t.data_fim.split('-').reverse().join('/') : 'N/D'}</td>
                    <td>${resp}</td>
                    <td><span class="status-pill ${sClass}">${t.status.toUpperCase()}</span></td>
                </tr>
            `;
        }).join('');
    }
    
    modal.classList.add('active');
}

function closeDrilldown() {
    document.getElementById('drilldownModal').classList.remove('active');
}

function drawGantt(tasks) {
    const container = document.getElementById('bi-gantt-container');
    container.innerHTML = '';

    // Filtra tarefas que têm data de início e fim
    const gTasks = tasks.filter(t => t.data_inicio && t.data_fim);
    if(gTasks.length === 0) {
        container.innerHTML = '<p style="color:#888; text-align:center;">Nenhuma tarefa com cronograma definido para os projetos selecionados.</p>';
        return;
    }

    // Descobre o limite de tempo (Timeline Total)
    let minDate = new Date(Math.min(...gTasks.map(t => new Date(t.data_inicio + 'T00:00:00'))));
    let maxDate = new Date(Math.max(...gTasks.map(t => new Date(t.data_fim + 'T00:00:00'))));
    
    // Adiciona uma margem de segurança de 2 dias nas pontas
    minDate.setDate(minDate.getDate() - 2);
    maxDate.setDate(maxDate.getDate() + 2);
    const totalDuration = maxDate - minDate; // em milissegundos

    let html = '';
    gTasks.forEach(t => {
        const start = new Date(t.data_inicio + 'T00:00:00');
        const end = new Date(t.data_fim + 'T00:00:00');
        const today = new Date();
        today.setHours(0,0,0,0);

        // Calcula posições percentuais
        const leftPerc = ((start - minDate) / totalDuration) * 100;
        const widthPerc = Math.max(((end - start) / totalDuration) * 100, 2); // Mínimo de 2% para tarefas de 1 dia

        let barClass = '';
        if(t.status === 'concluido') barClass = 'concluido';
        else if(end < today) barClass = 'atrasado';

        html += `
            <div class="gantt-row">
                <div class="gantt-label" title="${t.text}">${t.text}</div>
                <div class="gantt-timeline">
                    <div class="gantt-bar ${barClass}" style="left: ${leftPerc}%; width: ${widthPerc}%;">
                        ${t.perc_desenvolvimento || 0}%
                    </div>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}