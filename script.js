// ==========================================================================
// 1. CONFIGURAÇÃO E INICIALIZAÇÃO
// ==========================================================================
const firebaseConfig = {
    apiKey: "AIzaSyC4utmTe19lRJdOJutVmJAdhkfeu4znkpI",
    authDomain: "centrodecomando-paulo.firebaseapp.com",
    projectId: "centrodecomando-paulo",
    storageBucket: "centrodecomando-paulo.firebasestorage.app",
    messagingSenderId: "949266387673",
    appId: "1:949266387673:web:1ca08986cac568a76f64c8",
    measurementId: "G-QE62CLW6GS"
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const db = firebase.firestore();
const auth = firebase.auth();

// URL DO BI (LOOKER STUDIO)
const LOOKER_STUDIO_EMBED_URL = "https://lookerstudio.google.com/embed/reporting/ed770545-0285-4838-8911-3c3bf86123b2/page/JZjsF"; 

let allTasks = [];
let allUsers = []; 
let chartInstance = null;
let currentTaskId = null;
let currentUserEmail = null; 
let currentUserRole = null; 

// ==========================================================================
// 2. NAVEGAÇÃO E CONTROLE DE TELA
// ==========================================================================
function showSection(sec) {
    document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-link').forEach(btn => btn.classList.remove('active'));

    const targetSection = document.getElementById(`sec-${sec}`);
    if (targetSection) targetSection.classList.add('active');

    // Estiliza o botão de navegação correspondente
    const navBtn = document.getElementById(`btn-nav-${sec === 'dashboard-bi' ? 'bi' : (sec === 'acompanhamento' ? 'op' : sec)}`);
    if (navBtn) navBtn.classList.add('active');

    if(sec === 'usuarios') renderUsers();
}

// Login/Logout
document.getElementById('login-btn').onclick = () => auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
function logout() { auth.signOut(); }

// Observer de Autenticação
auth.onAuthStateChanged(async user => {
    if (user) {
        currentUserEmail = user.email.toLowerCase();
        try {
            const userQuery = await db.collection('usuarios').where('email', '==', currentUserEmail).get();
            if (userQuery.empty) {
                alert("Acesso Negado. Usuário não credenciado.");
                auth.signOut();
                return;
            }
            const userData = userQuery.docs[0].data();
            currentUserRole = userData.papel;

            document.getElementById('login-screen').style.display = 'none';
            document.getElementById('app-screen').style.display = 'block';
            document.getElementById('saudacao').innerText = `Olá, ${userData.nome.split(' ')[0]} (${currentUserRole.toUpperCase()})`;
            
            // Controle de acesso aos botões
            const btnNovo = document.getElementById('btn-nav-novo');
            const btnUsuarios = document.getElementById('btn-nav-usuarios');
            if(btnNovo) btnNovo.style.display = (currentUserRole === 'super-admin' || currentUserRole === 'gestor') ? 'inline-block' : 'none';
            if(btnUsuarios) btnUsuarios.style.display = (currentUserRole === 'super-admin') ? 'inline-block' : 'none';
            
            initializeBI();
            loadData();
            loadUsersDatabase();
            showSection('dashboard-bi'); 
            
        } catch (error) {
            console.error("Erro na autenticação:", error);
            auth.signOut();
        }
    } else {
        document.getElementById('login-screen').style.display = 'flex';
        document.getElementById('app-screen').style.display = 'none';
    }
});

function initializeBI() {
    const iframe = document.getElementById('bi-iframe');
    if(iframe && LOOKER_STUDIO_EMBED_URL !== "") {
        iframe.src = LOOKER_STUDIO_EMBED_URL;
    }
}

// ==========================================================================
// 3. GESTÃO DE DADOS (FIREBASE)
// ==========================================================================
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
        if(document.getElementById('sec-usuarios').classList.contains('active')) renderUsers();
    });
}

// POPULAR SELECTS DE EQUIPE
function populateUserSelects() {
    const selects = document.querySelectorAll('.resp-select');
    const optionsHTML = '<option value="">Selecione um membro...</option>' + 
        allUsers.map(u => `<option value="${u.email}">${u.nome}</option>`).join('');
    
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
    const optionsHTML = '<option value="">Selecione um membro...</option>' + 
        allUsers.map(u => `<option value="${u.email}">${u.nome}</option>`).join('');
    
    div.innerHTML = `<select class="resp-select">${optionsHTML}</select>`;
    container.appendChild(div);
}

// SALVAR NOVA DEMANDA
async function saveDemand() {
    if (currentUserRole !== 'super-admin' && currentUserRole !== 'gestor') return;

    const project = document.getElementById('projectInput').value;
    const title = document.getElementById('taskTitle').value; 
    const desc = document.getElementById('taskDesc').value;
    const dateStart = document.getElementById('dateInputStart').value;
    const dateEnd = document.getElementById('dateInputEnd').value;
    const area = document.getElementById('areaSelect').value;
    
    const resps = [];
    document.querySelectorAll('.resp-select').forEach(sel => {
        if(sel.value) {
            const userObj = allUsers.find(u => u.email === sel.value);
            if(userObj && !resps.find(r => r.email === userObj.email)) {
                resps.push({ nome: userObj.nome, email: userObj.email });
            }
        }
    });

    if(!project || !title || !dateStart || !dateEnd || resps.length === 0) {
        alert("Preencha todos os campos obrigatórios (Projeto, Título, Datas e Equipe).");
        return;
    }

    const taskData = {
        project, text: title, descricao: desc, area, resps,
        data_inicio: dateStart, data_fim: dateEnd,
        perc_desenvolvimento: 0,
        status: 'fazer', criadoEm: new Date(), historico: [],
        email: resps[0].email 
    };

    try {
        await db.collection('tarefas').add(taskData);
        alert("Demanda registrada. Notificando equipe...");
        
        for (const r of resps) {
            await emailjs.send("service_yw91uty", "template_p5wyzq8", {
                responsavel: r.nome,
                projeto: project,
                email_to: r.email 
            });
        }
        
        alert("Sucesso! Equipe notificada por e-mail.");
        limparFormularioDemanda();
        showSection('acompanhamento');
    } catch (e) { console.error(e); alert("Erro ao salvar."); }
}

function limparFormularioDemanda() {
    document.getElementById('taskTitle').value = "";
    document.getElementById('taskDesc').value = "";
    document.getElementById('projectInput').value = "";
}

// ==========================================================================
// 4. INTERFACE E DASHBOARD
// ==========================================================================
function getVisibleTasks() {
    if (currentUserRole === 'super-admin' || currentUserRole === 'gestor') return allTasks; 
    return allTasks.filter(t => t.resps && t.resps.some(r => r.email === currentUserEmail));
}

function updateProjectList() {
    const tasks = getVisibleTasks();
    const list = document.getElementById('projectsList');
    const filter = document.getElementById('filterProject');
    const projects = [...new Set(tasks.map(t => t.project))].sort();
    
    if(list) list.innerHTML = projects.map(p => `<option value="${p}">`).join('');
    
    if(filter) {
        const currentSelection = filter.value;
        let optionsHTML = '<option value="geral">Todos os Projetos</option>';
        projects.forEach(p => { optionsHTML += `<option value="${p}">${p}</option>`; });
        filter.innerHTML = optionsHTML;
        filter.value = (currentSelection && projects.includes(currentSelection)) ? currentSelection : 'geral';
    }
}

function renderDashboard() {
    const visibleTasks = getVisibleTasks();
    const selected = document.getElementById('filterProject').value;
    const filtered = selected === 'geral' ? visibleTasks : visibleTasks.filter(t => t.project === selected);
    
    const stats = {
        total: filtered.length,
        atrasadas: filtered.filter(t => t.status !== 'concluido' && t.data_fim && new Date(t.data_fim) < new Date()).length,
        pendentes: filtered.filter(t => t.status === 'aprovacao').length,
        concluidas: filtered.filter(t => t.status === 'concluido').length
    };

    document.getElementById('stats-grid').innerHTML = `
        <div class="stat-card shadow"><h3>${stats.total}</h3><p>Demandas</p></div>
        <div class="stat-card shadow" style="border-left: 4px solid #dc3545"><h3>${stats.atrasadas}</h3><p>Atrasadas</p></div>
        <div class="stat-card shadow" style="border-left: 4px solid #3b82f6"><h3>${stats.pendentes}</h3><p>Aguardando OK</p></div>
        <div class="stat-card shadow" style="border-left: 4px solid #28a745"><h3>${stats.concluidas}</h3><p>Finalizadas</p></div>
    `;
}

function renderBoard() {
    const board = document.getElementById('projectsBoard');
    const visibleTasks = getVisibleTasks();
    const selected = document.getElementById('filterProject').value;
    const filtered = selected === 'geral' ? visibleTasks : visibleTasks.filter(t => t.project === selected);

    if(filtered.length === 0) { 
        board.innerHTML = '<p style="padding:40px; text-align:center; color:#888;">Nenhuma atividade no radar.</p>'; 
        return; 
    }

    let html = `<table><thead><tr>
        <th>Projeto</th><th>Tarefa</th><th>Prazo</th><th>Resp.</th><th>Status</th>
    </tr></thead><tbody>`;

    filtered.forEach(t => {
        const respNome = t.resps ? t.resps[0].nome.split(' ')[0] : 'N/D';
        const sClass = `status-${t.status === 'concluido' ? 'concluido' : (t.status === 'aprovacao' ? 'andamento' : 'fazer')}`;
        
        html += `<tr onclick="abrirModal('${t.id}')" style="cursor:pointer">
            <td class="bold">${t.project}</td>
            <td>${t.text} <br><small style="color:#888">${t.perc_desenvolvimento || 0}% concluído</small></td>
            <td>${t.data_fim ? t.data_fim.split('-').reverse().join('/') : 'N/D'}</td>
            <td>${respNome}</td>
            <td><span class="status-pill ${sClass}">${t.status.toUpperCase()}</span></td>
        </tr>`;
    });

    html += `</tbody></table>`;
    board.innerHTML = html;
}

// ==========================================================================
// 5. MODAL DE GESTÃO E EDIÇÃO
// ==========================================================================
function abrirModal(id) {
    currentTaskId = id;
    const t = allTasks.find(x => x.id === id);
    const modal = document.getElementById('taskModal');
    modal.classList.add('active');
    
    const isGestor = (currentUserRole === 'super-admin' || currentUserRole === 'gestor');
    
    document.getElementById('editTitle').value = t.text;
    document.getElementById('editTitle').disabled = !isGestor;
    document.getElementById('editDateStart').value = t.data_inicio || "";
    document.getElementById('editDateStart').disabled = !isGestor;
    document.getElementById('editDateEnd').value = t.data_fim || "";
    document.getElementById('editDateEnd').disabled = !isGestor;
    document.getElementById('editDesc').value = t.descricao || "";
    document.getElementById('editPerc').value = t.perc_desenvolvimento || 0;
    
    const statusSelect = document.getElementById('editStatus');
    statusSelect.value = t.status;
    document.getElementById('opt-concluido').style.display = isGestor ? 'block' : 'none';

    // Histórico
    const histContainer = document.getElementById('modalHistorico');
    histContainer.innerHTML = (t.historico && t.historico.length > 0) ? 
        t.historico.map(h => `<div class="history-item">
            <strong>${h.autor.split('@')[0]}</strong> <small>${h.data}</small><br>${h.texto}
        </div>`).join('') : "<em>Sem reportes.</em>";
    
    document.getElementById('btn-delete-task').style.display = isGestor ? 'inline-block' : 'none';
}

function closeModal() { document.getElementById('taskModal').classList.remove('active'); }

async function saveModalChanges() {
    const t = allTasks.find(x => x.id === currentTaskId);
    const isGestor = (currentUserRole === 'super-admin' || currentUserRole === 'gestor');
    const newReportText = document.getElementById('newReport').value.trim();
    const newStatus = document.getElementById('editStatus').value;
    const newPerc = document.getElementById('editPerc').value;
    
    const update = { 
        status: newStatus, 
        perc_desenvolvimento: parseInt(newPerc) || 0 
    };

    if(isGestor) {
        update.text = document.getElementById('editTitle').value;
        update.data_inicio = document.getElementById('editDateStart').value;
        update.data_fim = document.getElementById('editDateEnd').value;
    }

    if(newReportText !== "") {
        update.historico = firebase.firestore.FieldValue.arrayUnion({
            data: new Date().toLocaleString('pt-BR'), autor: currentUserEmail, texto: newReportText
        });
    }

    await db.collection('tarefas').doc(currentTaskId).update(update);
    document.getElementById('newReport').value = "";
    closeModal();
}

async function deleteTask() {
    if(confirm("Tem certeza que deseja EXCLUIR esta demanda estrategica?")) {
        await db.collection('tarefas').doc(currentTaskId).delete();
        closeModal();
    }
}

// ==========================================================================
// 6. GESTÃO DE USUÁRIOS
// ==========================================================================
async function cadastrarUsuario() {
    const nome = document.getElementById('novoUserNome').value.trim();
    const email = document.getElementById('novoUserEmail').value.toLowerCase().trim();
    const papel = document.getElementById('novoUserPapel').value;
    if(!nome || !email) return alert("Nome e e-mail são obrigatórios.");
    await db.collection('usuarios').add({ nome, email, papel });
    alert("Membro credenciado!");
}

function renderUsers() {
    const board = document.getElementById('lista-usuarios-board');
    board.innerHTML = allUsers.map(u => `
        <div class="user-card shadow">
            <div><strong>${u.nome}</strong><br><small>${u.email} | ${u.papel.toUpperCase()}</small></div>
            ${u.email !== currentUserEmail ? `<button onclick="removerUsuario('${u.id}')" class="btn-danger">Remover</button>` : ''}
        </div>
    `).join('');
}

async function removerUsuario(id) {
    if(confirm("Revogar acesso deste membro?")) await db.collection('usuarios').doc(id).delete();
}