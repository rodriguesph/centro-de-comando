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

// VARIÁVEIS GLOBAIS
let allTasks = [];
let allUsers = []; // Guarda a lista de usuários da equipe
let chartInstance = null;
let currentTaskId = null;
let currentUserEmail = null; 
let currentUserRole = null; 

// 2. NAVEGAÇÃO E UI
function showSection(sec) {
    document.querySelectorAll('.content-section').forEach(s => s.style.display = 'none');
    document.getElementById(`sec-${sec}`).style.display = 'block';
    if(sec === 'usuarios') renderUsers(); // Renderiza a lista se abrir a aba de usuários
}

function addResponsavelField() {
    const container = document.getElementById('responsaveis-container');
    const div = document.createElement('div');
    div.className = 'resp-row';
    div.style = "display: flex; gap: 5px; margin-bottom: 5px;";
    div.innerHTML = `<input type="text" class="resp-name" placeholder="Nome Responsável"><input type="email" class="resp-email" placeholder="E-mail">`;
    container.appendChild(div);
}

// 3. A TRAVA DA PORTA (AUTH GUARD COM RBAC)
auth.onAuthStateChanged(async user => {
    if (user) {
        currentUserEmail = user.email.toLowerCase();
        
        try {
            const userQuery = await db.collection('usuarios').where('email', '==', currentUserEmail).get();
            
            if (userQuery.empty) {
                alert("Acesso Negado: Você não faz parte desta equipe ou não foi cadastrado pelo Coordenador.");
                auth.signOut();
                return;
            }

            const userData = userQuery.docs[0].data();
            currentUserRole = userData.papel;

            document.getElementById('login-screen').style.display = 'none';
            document.getElementById('app-screen').style.display = 'block';
            document.getElementById('saudacao').innerText = `Olá, ${userData.nome || 'Usuário'} (${currentUserRole.toUpperCase()})`;
            
            // Controle de Botões do Menu
            const btnNovo = document.getElementById('btn-nav-novo');
            const btnUsuarios = document.getElementById('btn-nav-usuarios');
            
            if(btnNovo) btnNovo.style.display = (currentUserRole === 'super-admin' || currentUserRole === 'gestor') ? 'inline-block' : 'none';
            if(btnUsuarios) btnUsuarios.style.display = (currentUserRole === 'super-admin') ? 'inline-block' : 'none';
            
            showSection('acompanhamento');
            loadData();
            
            // Se for super-admin, já escuta a tabela de usuários
            if(currentUserRole === 'super-admin') {
                loadUsersDatabase();
            }
            
        } catch (error) {
            console.error("Erro na catraca de segurança:", error);
            alert("Erro ao validar credenciais. Contate o suporte.");
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

// 4. CARREGAMENTO DE DADOS (TAREFAS E USUÁRIOS)
function loadData() {
    db.collection('tarefas').onSnapshot(snapshot => {
        allTasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderDashboard();
        renderBoard();
    });
}

function loadUsersDatabase() {
    db.collection('usuarios').onSnapshot(snapshot => {
        allUsers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if(document.getElementById('sec-usuarios').style.display === 'block') {
            renderUsers();
        }
    });
}

// 5. MÓDULO DE GESTÃO DE EQUIPE (SUPER-ADMIN)
async function cadastrarUsuario() {
    if(currentUserRole !== 'super-admin') return;

    const nome = document.getElementById('novoUserNome').value.trim();
    const email = document.getElementById('novoUserEmail').value.toLowerCase().trim();
    const papel = document.getElementById('novoUserPapel').value;

    if(!nome || !email) {
        alert("Preencha Nome e E-mail para cadastrar.");
        return;
    }

    // Verifica se já existe
    const duplicado = allUsers.find(u => u.email === email);
    if(duplicado) {
        alert("Este e-mail já possui acesso cadastrado no sistema.");
        return;
    }

    await db.collection('usuarios').add({ nome, email, papel });
    alert("Usuário adicionado com sucesso!");
    document.getElementById('novoUserNome').value = "";
    document.getElementById('novoUserEmail').value = "";
}

async function removerUsuario(id, email) {
    if(currentUserRole !== 'super-admin') return;
    if(email === currentUserEmail) {
        alert("Ação negada: Você não pode excluir a si mesmo.");
        return;
    }

    if(confirm(`Tem certeza que deseja REVOGAR O ACESSO de ${email}?`)) {
        await db.collection('usuarios').doc(id).delete();
        alert("Acesso revogado.");
    }
}

function renderUsers() {
    const board = document.getElementById('lista-usuarios-board');
    if(!board) return;
    board.innerHTML = '';

    allUsers.forEach(u => {
        const div = document.createElement('div');
        div.style = "display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid #ddd; background: #f8fafc; border-radius: 4px; margin-bottom: 5px;";
        div.innerHTML = `
            <div>
                <strong>${u.nome}</strong> <br>
                <small style="color: #64748b;">${u.email} | Nível: <span style="font-weight:bold; color: ${u.papel === 'super-admin' ? 'red' : (u.papel === 'gestor' ? 'orange' : 'green')}">${u.papel.toUpperCase()}</span></small>
            </div>
            ${u.email !== currentUserEmail ? `<button onclick="removerUsuario('${u.id}', '${u.email}')" class="btn-small" style="background:#ef4444;">Remover</button>` : '<span>(Você)</span>'}
        `;
        board.appendChild(div);
    });
}

// 6. REGRAS DE VISUALIZAÇÃO DE TAREFAS
function getVisibleTasks() {
    if (currentUserRole === 'super-admin' || currentUserRole === 'gestor') return allTasks; 
    return allTasks.filter(t => {
        if (t.resps && t.resps.length > 0) return t.resps.some(r => r.email === currentUserEmail);
        return t.email === currentUserEmail; 
    });
}

function updateProjectList(tasksToRender) {
    const list = document.getElementById('projectsList');
    const filter = document.getElementById('filterProject');
    const projects = [...new Set(tasksToRender.map(t => t.project))];
    if(list) list.innerHTML = projects.map(p => `<option value="${p}">`).join('');
    if(filter) filter.innerHTML = '<option value="geral">Visão Geral</option>' + projects.map(p => `<option value="${p}">${p}</option>`).join('');
}

// 7. SALVAR DEMANDA (EMAILJS)
async function saveDemand() {
    if (currentUserRole !== 'super-admin' && currentUserRole !== 'gestor') return;

    const project = document.getElementById('projectInput').value;
    const title = document.getElementById('taskTitle').value; 
    const desc = document.getElementById('taskDesc').value;
    const date = document.getElementById('dateInput').value;
    const area = document.getElementById('areaSelect').value;
    
    const resps = Array.from(document.querySelectorAll('.resp-row')).map(row => ({
        nome: row.querySelector('.resp-name').value,
        email: row.querySelector('.resp-email').value.toLowerCase().trim()
    })).filter(r => r.email !== "");

    if(!project || !title || resps.length === 0) {
        alert("Erro: Projeto, Título e Responsável são obrigatórios.");
        return;
    }

    const taskData = {
        project, text: title, descricao: desc, date: date || "Sem prazo",
        area, resps, status: 'fazer', criadoEm: new Date(), historico: [],
        email: resps[0].email
    };

    await db.collection('tarefas').add(taskData);
    
    resps.forEach(r => {
        emailjs.send("service_yw91uty", "template_p5wyzq8", {
            responsavel: r.nome,
            projeto: project,
            email_to: r.email 
        }).then(() => console.log("E-mail enviado para " + r.nome))
          .catch(err => console.error("Erro no e-mail", err));
    });

    alert("Demanda lançada e equipe notificada!");
    document.getElementById('taskTitle').value = "";
    document.getElementById('taskDesc').value = "";
    showSection('acompanhamento');
}

// 8. DASHBOARD E QUADRO DE TAREFAS
function renderDashboard() {
    const visibleTasks = getVisibleTasks();
    updateProjectList(visibleTasks);

    const selected = document.getElementById('filterProject').value;
    const filtered = selected === 'geral' ? visibleTasks : visibleTasks.filter(t => t.project === selected);
    
    const stats = {
        total: filtered.length,
        atrasadas: filtered.filter(t => t.status !== 'aprovacao' && t.date !== "Sem prazo" && new Date(t.date) < new Date()).length,
        pendentes: filtered.filter(t => t.status === 'aprovacao').length,
        concluidas: filtered.filter(t => t.status === 'aprovacao').length
    };

    document.getElementById('stats-grid').innerHTML = `
        <div class="stat-card"><h3>${stats.total}</h3><p>Tarefas</p></div>
        <div class="stat-card" style="color:red"><h3>${stats.atrasadas}</h3><p>Atrasadas</p></div>
        <div class="stat-card" style="color:blue"><h3>${stats.pendentes}</h3><p>Pendentes OK</p></div>
        <div class="stat-card"><h3>${stats.total > 0 ? Math.round((stats.concluidas/stats.total)*100) : 0}%</h3><p>Conclusão</p></div>
    `;

    updateChart(filtered);
}

function updateChart(tasks) {
    const s = { fazer: 0, andamento: 0, aprovacao: 0 };
    tasks.forEach(t => s[t.status] = (s[t.status] || 0) + 1);
    const ctx = document.getElementById('mainChart').getContext('2d');
    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Fazer', 'Andamento', 'OK'],
            datasets: [{ data: [s.fazer, s.andamento, s.aprovacao], backgroundColor: ['#ef4444', '#f59e0b', '#10b981'] }]
        }
    });
}

function renderBoard() {
    const board = document.getElementById('projectsBoard');
    board.innerHTML = '';
    
    const visibleTasks = getVisibleTasks();

    if(visibleTasks.length === 0) {
        board.innerHTML = '<p style="text-align:center; padding:20px; color:#64748b;">Você não possui tarefas designadas ou visíveis no momento.</p>';
        return;
    }

    const grouped = visibleTasks.reduce((acc, t) => {
        if (!acc[t.project]) acc[t.project] = [];
        acc[t.project].push(t);
        return acc;
    }, {});

    for (const [proj, tasks] of Object.entries(grouped)) {
        let html = `<div class="project-card" style="margin-bottom:15px; border:1px solid #e2e8f0; padding:10px; border-radius:8px; background:#fff;">
            <h4 style="background:#1e293b; color:white; padding:8px; border-radius:4px; margin-bottom:10px;">📁 ${proj}</h4>`;
        
        tasks.forEach(t => {
            const nomeResp = t.resps && t.resps.length > 0 ? t.resps[0].nome : (t.responsavel || "Não atribuído");
            html += `<div class="task-item" onclick="abrirModal('${t.id}')" style="cursor:pointer; padding:8px; border-bottom:1px solid #f1f5f9;">
                <strong>${t.text}</strong> <small style="color:#64748b;">(${nomeResp})</small>
                <span style="float:right; font-size:0.8rem; background:#e2e8f0; padding:4px 8px; border-radius:4px; font-weight:bold;">${t.status.toUpperCase()}</span>
            </div>`;
        });
        
        html += `</div>`;
        board.innerHTML += html;
    }
}

// 9. MODAL DE GESTÃO (COM TRAVAS DE BOTÃO)
async function abrirModal(id) {
    currentTaskId = id;
    const t = allTasks.find(x => x.id === id);
    document.getElementById('taskModal').style.display = 'block';
    
    // Executor não edita Título e Prazo, só vê
    const isGestor = (currentUserRole === 'super-admin' || currentUserRole === 'gestor');
    document.getElementById('editTitle').value = t.text;
    document.getElementById('editTitle').disabled = !isGestor;
    
    document.getElementById('editDate').value = t.date !== "Sem prazo" ? t.date : "";
    document.getElementById('editDate').disabled = !isGestor;
    
    // Qualquer um pode reportar/mudar status
    document.getElementById('editDesc').value = t.descricao || "";
    document.getElementById('editStatus').value = t.status;
    document.getElementById('modalHistorico').innerHTML = (t.historico || []).map(h => `<div>[${h.data}] ${h.texto}</div>`).join('');
    
    // Botão de Excluir só para Gestores
    const btnExcluir = document.getElementById('btn-delete-task');
    if (btnExcluir) {
        btnExcluir.style.display = isGestor ? 'inline-block' : 'none';
    }
}

function closeModal() { document.getElementById('taskModal').style.display = 'none'; }

async function saveModalChanges() {
    const isGestor = (currentUserRole === 'super-admin' || currentUserRole === 'gestor');
    
    // Executor só atualiza descricao, status e historico. Gestor atualiza tudo.
    const update = {
        descricao: document.getElementById('editDesc').value,
        status: document.getElementById('editStatus').value,
        historico: firebase.firestore.FieldValue.arrayUnion({ 
            data: new Date().toLocaleDateString(), 
            texto: `Alterado por ${currentUserEmail}` 
        })
    };

    if(isGestor) {
        update.text = document.getElementById('editTitle').value;
        update.date = document.getElementById('editDate').value || "Sem prazo";
    }

    await db.collection('tarefas').doc(currentTaskId).update(update);
    alert("Tarefa atualizada!");
    closeModal();
}

async function deleteTask() {
    if(currentUserRole !== 'super-admin' && currentUserRole !== 'gestor') return; 

    if(confirm("Deseja realmente EXCLUIR esta demanda? Esta ação é irreversível.")) {
        await db.collection('tarefas').doc(currentTaskId).delete();
        alert("Demanda excluída.");
        closeModal();
    }
}