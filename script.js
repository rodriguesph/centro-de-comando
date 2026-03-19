// 1. CONFIGURAÇÃO DO FIREBASE
const firebaseConfig = {
    apiKey: "AIzaSyC4utmTe19lRJdOJutVmJAdhkfeu4znkpI",
    authDomain: "centrodecomando-paulo.firebaseapp.com",
    projectId: "centrodecomando-paulo",
    storageBucket: "centrodecomando-paulo.firebasestorage.app",
    messagingSenderId: "949266387673",
    appId: "1:949266387673:web:1ca08986cac568a76f64c8",
    measurementId: "G-QE62CLW6GS"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

// PAULO: Após configurar o Looker Studio, cole a URL do iframe aqui entre aspas.
const LOOKER_STUDIO_EMBED_URL = "https://lookerstudio.google.com/embed/reporting/ed770545-0285-4838-8911-3c3bf86123b2/page/JZjsF"; 

let allTasks = [];
let allUsers = []; 
let chartInstance = null;
let currentTaskId = null;
let currentUserEmail = null; 
let currentUserRole = null; 

function showSection(sec) {
    document.querySelectorAll('.content-section').forEach(s => s.style.display = 'none');
    document.getElementById(`sec-${sec}`).style.display = 'block';
    if(sec === 'usuarios') renderUsers();
}

function populateUserSelects() {
    const selects = document.querySelectorAll('.resp-select');
    const optionsHTML = '<option value="">Selecione um membro credenciado...</option>' + 
        allUsers.map(u => `<option value="${u.email}">${u.nome} (${u.email})</option>`).join('');
    
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
    div.style = "display: flex; gap: 5px; margin-bottom: 5px;";
    
    const optionsHTML = '<option value="">Selecione um membro credenciado...</option>' + 
        allUsers.map(u => `<option value="${u.email}">${u.nome} (${u.email})</option>`).join('');
    
    div.innerHTML = `<select class="resp-select" style="width: 100%;">${optionsHTML}</select>`;
    container.appendChild(div);
}

auth.onAuthStateChanged(async user => {
    if (user) {
        currentUserEmail = user.email.toLowerCase();
        try {
            const userQuery = await db.collection('usuarios').where('email', '==', currentUserEmail).get();
            if (userQuery.empty) {
                alert("Acesso Negado.");
                auth.signOut();
                return;
            }
            const userData = userQuery.docs[0].data();
            currentUserRole = userData.papel;

            document.getElementById('login-screen').style.display = 'none';
            document.getElementById('app-screen').style.display = 'block';
            document.getElementById('saudacao').innerText = `Olá, ${userData.nome || 'Usuário'} (${currentUserRole.toUpperCase()})`;
            
            const btnNovo = document.getElementById('btn-nav-novo');
            const btnUsuarios = document.getElementById('btn-nav-usuarios');
            if(btnNovo) btnNovo.style.display = (currentUserRole === 'super-admin' || currentUserRole === 'gestor') ? 'inline-block' : 'none';
            if(btnUsuarios) btnUsuarios.style.display = (currentUserRole === 'super-admin') ? 'inline-block' : 'none';
            
            showSection('dashboard-bi'); // Começa na aba do BI
            initializeBI(); // Carrega o BI se a URL estiver pronta
            loadData();
            loadUsersDatabase(); 
            
        } catch (error) {
            console.error(error);
            auth.signOut();
        }
    } else {
        document.getElementById('login-screen').style.display = 'flex';
        document.getElementById('app-screen').style.display = 'none';
        currentUserEmail = null;
        currentUserRole = null;
    }
});

document.getElementById('login-btn').onclick = () => auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
function logout() { auth.signOut(); }

function initializeBI() {
    const container = document.getElementById('bi-embed-container');
    if(LOOKER_STUDIO_EMBED_URL !== "") {
        container.innerHTML = `<iframe width="100%" height="100%" src="${LOOKER_STUDIO_EMBED_URL}" frameborder="0" style="border:0" allowfullscreen></iframe>`;
        container.style.border = "none";
        container.style.padding = "0";
    }
}

function loadData() {
    db.collection('tarefas').onSnapshot(snapshot => {
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
        if(document.getElementById('sec-usuarios').style.display === 'block') renderUsers();
    });
}

// SALVAR NOVA DEMANDA (COM DATA INÍCIO E FIM)
async function saveDemand() {
    if (currentUserRole !== 'super-admin' && currentUserRole !== 'gestor') return;

    const project = document.getElementById('projectInput').value;
    const title = document.getElementById('taskTitle').value; 
    const desc = document.getElementById('taskDesc').value;
    const dateStart = document.getElementById('dateInputStart').value; // Feature 4
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
        alert("Erro: Projeto, Título, Responsável e Datas (Início e Fim) são obrigatórios.");
        return;
    }

    const taskData = {
        project, text: title, descricao: desc, area, resps,
        data_inicio: dateStart, data_fim: dateEnd, // Fundação para o BI
        perc_desenvolvimento: 0, // Feature 3 inicial
        status: 'fazer', criadoEm: new Date(), historico: [],
        email: resps[0].email 
    };

    await db.collection('tarefas').add(taskData);
    
    alert("Salvando demanda e disparando notificações em fila sequencial...");
    for (const r of resps) {
        try {
            await emailjs.send("service_yw91uty", "template_p5wyzq8", {
                responsavel: r.nome,
                projeto: project,
                email_to: r.email 
            });
        } catch (error) {
            console.error(`Falha no e-mail para ${r.nome}`, error);
        }
    }
    alert("Demanda lançada e equipe notificada!");
    document.getElementById('taskTitle').value = "";
    document.getElementById('taskDesc').value = "";
    showSection('acompanhamento');
}

function getVisibleTasks() {
    if (currentUserRole === 'super-admin' || currentUserRole === 'gestor') return allTasks; 
    return allTasks.filter(t => {
        if (t.resps && t.resps.length > 0) return t.resps.some(r => r.email === currentUserEmail);
        return t.email === currentUserEmail; 
    });
}

function updateProjectList() {
    const tasksToRender = getVisibleTasks();
    const list = document.getElementById('projectsList');
    const filter = document.getElementById('filterProject');
    const projects = [...new Set(tasksToRender.map(t => t.project))].sort();
    
    if(list) list.innerHTML = projects.map(p => `<option value="${p}">`).join('');
    
    if(filter) {
        const currentSelection = filter.value;
        let optionsHTML = '<option value="geral">Todos os Projetos</option>';
        projects.forEach(p => { optionsHTML += `<option value="${p}">${p}</option>`; });
        filter.innerHTML = optionsHTML;
        if (currentSelection && projects.includes(currentSelection)) filter.value = currentSelection;
        else filter.value = 'geral';
    }
}

function renderDashboard() {
    const visibleTasks = getVisibleTasks();
    const selected = document.getElementById('filterProject').value;
    const filtered = selected === 'geral' ? visibleTasks : visibleTasks.filter(t => t.project === selected);
    
    const stats = {
        total: filtered.length,
        atrasadas: filtered.filter(t => t.status !== 'concluido' && t.status !== 'aprovacao' && t.data_fim && new Date(t.data_fim) < new Date()).length,
        pendentes: filtered.filter(t => t.status === 'aprovacao').length,
        concluidas: filtered.filter(t => t.status === 'concluido').length
    };

    document.getElementById('stats-grid').innerHTML = `
        <div class="stat-card"><h3>${stats.total}</h3><p>Total Delegado</p></div>
        <div class="stat-card" style="color:red; border-bottom: 4px solid red;"><h3>${stats.atrasadas}</h3><p>Atrasadas</p></div>
        <div class="stat-card" style="color:blue; border-bottom: 4px solid blue;"><h3>${stats.pendentes}</h3><p>Aguardando OK Gestor</p></div>
        <div class="stat-card" style="color:green; border-bottom: 4px solid green;"><h3>${stats.concluidas}</h3><p>Concluídas</p></div>
    `;

    updateChart(filtered);
}

function updateChart(tasks) {
    const s = { fazer: 0, andamento: 0, aprovacao: 0, concluido: 0 };
    tasks.forEach(t => s[t.status] = (s[t.status] || 0) + 1);
    const ctx = document.getElementById('mainChart').getContext('2d');
    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Fazer', 'Andamento', 'OK Gestor', 'Concluído'],
            datasets: [{ data: [s.fazer, s.andamento, s.aprovacao, s.concluido], backgroundColor: ['#ef4444', '#f59e0b', '#3b82f6', '#10b981'] }]
        },
        options: { plugins: { legend: { position: 'bottom' } } }
    });
}

function renderBoard() {
    const board = document.getElementById('projectsBoard');
    board.innerHTML = '';
    const visibleTasks = getVisibleTasks();
    const selected = document.getElementById('filterProject').value;
    const filtered = selected === 'geral' ? visibleTasks : visibleTasks.filter(t => t.project === selected);

    if(filtered.length === 0) { board.innerHTML = '<p style="text-align:center; padding:20px;">Nenhuma tarefa pendente.</p>'; return; }

    const grouped = filtered.reduce((acc, t) => {
        if (!acc[t.project]) acc[t.project] = [];
        acc[t.project].push(t);
        return acc;
    }, {});

    for (const [proj, tasks] of Object.entries(grouped)) {
        let html = `<div class="project-card" style="margin-bottom:15px; border:1px solid #e2e8f0; padding:10px; border-radius:8px; background:#fff;">
            <h4 style="background:#1e293b; color:white; padding:8px; border-radius:4px; margin-bottom:10px;">📁 ${proj}</h4>`;
        
        tasks.forEach(t => {
            const nomeResp = t.resps && t.resps.length > 0 ? t.resps.map(r => r.nome.split(' ')[0]).join(', ') : "Não atribuído";
            const statusColor = t.status === 'concluido' ? 'background:#10b981; color:white;' : (t.status === 'aprovacao' ? 'background:#3b82f6; color:white;' : 'background:#e2e8f0;');
            const perc = t.perc_desenvolvimento || 0; // Feature 3
            
            html += `<div class="task-item" onclick="abrirModal('${t.id}')" style="cursor:pointer; padding:8px; border-bottom:1px solid #f1f5f9; display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <strong>${t.text}</strong> <small style="color:#64748b;">(${nomeResp})</small><br>
                    <small style="color:#94a3b8;">📅 Fim: ${t.data_fim || t.date || "N/D"}</small>
                </div>
                <div style="text-align:right;">
                    <span style="font-size:0.75rem; padding:4px 8px; border-radius:4px; font-weight:bold; ${statusColor}">${t.status.toUpperCase()}</span><br>
                    <small style="font-weight:bold; color: ${statusColor === 'background:#10b981; color:white;' ? '#10b981' : '#475569'};">${perc}%</small>
                </div>
            </div>`;
        });
        html += `</div>`;
        board.innerHTML += html;
    }
}

// 6. MODAL DE GESTÃO (COM DATAS E PERCENTUAL)
async function abrirModal(id) {
    currentTaskId = id;
    const t = allTasks.find(x => x.id === id);
    document.getElementById('taskModal').style.display = 'block';
    
    const isGestor = (currentUserRole === 'super-admin' || currentUserRole === 'gestor');
    
    document.getElementById('editTitle').value = t.text;
    document.getElementById('editTitle').disabled = !isGestor;
    
    // Feature 4: Datas Início e Fim no Modal
    document.getElementById('editDateStart').value = t.data_inicio || "";
    document.getElementById('editDateStart').disabled = !isGestor;
    document.getElementById('editDateEnd').value = t.data_fim || t.date || ""; // Usa t.date como fallback legado
    document.getElementById('editDateEnd').disabled = !isGestor;
    
    document.getElementById('editDesc').value = t.descricao || "Sem escopo inicial.";
    document.getElementById('editDesc').disabled = !isGestor; 
    
    // Feature 3: Percentual de Desenvolvimento
    document.getElementById('editPerc').value = t.perc_desenvolvimento || 0;
    
    document.getElementById('newReport').value = ""; 
    
    const statusSelect = document.getElementById('editStatus');
    statusSelect.value = t.status;
    const optConcluido = document.getElementById('opt-concluido');
    if (optConcluido) optConcluido.style.display = isGestor ? 'block' : 'none';
    
    if (!isGestor && t.status === 'concluido') {
        statusSelect.disabled = true;
        document.getElementById('editPerc').disabled = true;
        document.getElementById('newReport').disabled = true;
        document.getElementById('newReport').placeholder = "Tarefa concluída. Bloqueada para executores.";
    } else {
        statusSelect.disabled = false;
        document.getElementById('editPerc').disabled = false;
        document.getElementById('newReport').disabled = false;
        document.getElementById('newReport').placeholder = "Adicionar novo reporte...";
    }

    const histContainer = document.getElementById('modalHistorico');
    if(t.historico && t.historico.length > 0) {
        histContainer.innerHTML = t.historico.map(h => {
            const autor = h.autor || "Sistema";
            return `<div style="margin-bottom: 10px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">
                        <strong style="color:#0f172a;">👤 ${autor}</strong> <span style="font-size:0.75rem; color:#64748b; float:right;">${h.data || ""}</span><br>
                        <span style="color:#334155; margin-top:4px; display:block;">${h.texto || h}</span>
                    </div>`;
        }).join('');
    } else {
        histContainer.innerHTML = "<em style='color:#94a3b8;'>Nenhum reporte.</em>";
    }
    
    const btnExcluir = document.getElementById('btn-delete-task');
    if (btnExcluir) btnExcluir.style.display = isGestor ? 'inline-block' : 'none';
}

function closeModal() { document.getElementById('taskModal').style.display = 'none'; }

async function saveModalChanges() {
    const t = allTasks.find(x => x.id === currentTaskId);
    const isGestor = (currentUserRole === 'super-admin' || currentUserRole === 'gestor');
    const newReportText = document.getElementById('newReport').value.trim();
    const newStatus = document.getElementById('editStatus').value;
    const newPerc = document.getElementById('editPerc').value; // Feature 3
    
    const update = { 
        status: newStatus, 
        perc_desenvolvimento: parseInt(newPerc) || 0 
    };

    if(isGestor) {
        update.text = document.getElementById('editTitle').value;
        update.data_inicio = document.getElementById('editDateStart').value;
        update.data_fim = document.getElementById('editDateEnd').value;
        update.descricao = document.getElementById('editDesc').value;
    }

    if(newReportText !== "") {
        update.historico = firebase.firestore.FieldValue.arrayUnion({
            data: new Date().toLocaleString('pt-BR'), autor: currentUserEmail, texto: newReportText
        });
    } else if (newStatus !== t.status || parseInt(newPerc) !== t.perc_desenvolvimento) { 
        update.historico = firebase.firestore.FieldValue.arrayUnion({
            data: new Date().toLocaleString('pt-BR'), autor: "SISTEMA",
            texto: `Atualizou: Status para [${newStatus.toUpperCase()}] e Progresso para ${newPerc}%`
        });
    }

    await db.collection('tarefas').doc(currentTaskId).update(update);
    alert("Salvo!");
    closeModal();
}

async function deleteTask() {
    if(currentUserRole !== 'super-admin' && currentUserRole !== 'gestor') return; 
    if(confirm("Deseja realmente EXCLUIR?")) {
        await db.collection('tarefas').doc(currentTaskId).delete();
        closeModal();
    }
}

// Adm Usuários (MANTIDO)
async function cadastrarUsuario() {
    if(currentUserRole !== 'super-admin') return;
    const nome = document.getElementById('novoUserNome').value.trim();
    const email = document.getElementById('novoUserEmail').value.toLowerCase().trim();
    const papel = document.getElementById('novoUserPapel').value;
    if(!nome || !email) return alert("Preencha Nome e E-mail.");
    if(allUsers.find(u => u.email === email)) return alert("E-mail já cadastrado.");
    await db.collection('usuarios').add({ nome, email, papel });
    document.getElementById('novoUserNome').value = ""; document.getElementById('novoUserEmail').value = "";
}

async function removerUsuario(id, email) {
    if(currentUserRole !== 'super-admin') return;
    if(email === currentUserEmail) return alert("Você não pode se auto-excluir.");
    if(confirm(`REVOGAR O ACESSO de ${email}?`)) await db.collection('usuarios').doc(id).delete();
}

function renderUsers() {
    const board = document.getElementById('lista-usuarios-board');
    if(!board) return;
    board.innerHTML = '';
    allUsers.forEach(u => {
        const div = document.createElement('div');
        div.style = "display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid #ddd; background: #f8fafc; border-radius: 4px; margin-bottom: 5px;";
        div.innerHTML = `<div><strong>${u.nome}</strong><br><small>${u.email} | Nível: <b>${u.papel.toUpperCase()}</b></small></div>
            ${u.email !== currentUserEmail ? `<button onclick="removerUsuario('${u.id}', '${u.email}')" class="btn-small" style="background:#ef4444;">Remover</button>` : '<span>(Você)</span>'}`;
        board.appendChild(div);
    });
}