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

// BI
function initializeBI() {
    const iframe = document.getElementById('bi-iframe');
    // Se o iframe existir e ainda estiver vazio, injeta a URL
    if(iframe && (iframe.src === "" || iframe.src === window.location.href)) {
        console.log("Iniciando carregamento do BI...");
        iframe.src = LOOKER_STUDIO_EMBED_URL;
    }
}

// Forçar carregamento inicial assim que o script rodar
window.onload = () => {
    if(document.getElementById('sec-dashboard-bi').classList.contains('active')) {
        initializeBI();
    }
};

// DADOS
function loadData() {
    db.collection('tarefas').orderBy('criadoEm', 'desc').onSnapshot(snapshot => {
        allTasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        updateProjectList();
        renderDashboard();
        renderBoard();
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