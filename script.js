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

// 2. CONTROLE DE AUTORIDADE (GESTORES)
// Coloque aqui os e-mails de quem pode CRIAR e VER TUDO. O resto será participante.
const MANAGERS = ["paulohenriquesrodrigues@gmail.com"]; 

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();
let allTasks = [];
let chartInstance = null;
let currentTaskId = null;
let currentUserEmail = null; // Guarda o e-mail do usuário logado

// 3. NAVEGAÇÃO E UI
function showSection(sec) {
    document.querySelectorAll('.content-section').forEach(s => s.style.display = 'none');
    document.getElementById(`sec-${sec}`).style.display = 'block';
}

function addResponsavelField() {
    const container = document.getElementById('responsaveis-container');
    const div = document.createElement('div');
    div.className = 'resp-row';
    div.style = "display: flex; gap: 5px; margin-bottom: 5px;";
    div.innerHTML = `<input type="text" class="resp-name" placeholder="Nome"><input type="email" class="resp-email" placeholder="E-mail">`;
    container.appendChild(div);
}

// 4. AUTENTICAÇÃO E PERMISSÕES
auth.onAuthStateChanged(user => {
    if (user) {
        currentUserEmail = user.email.toLowerCase();
        const isManager = MANAGERS.includes(currentUserEmail);

        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('app-screen').style.display = 'block';
        document.getElementById('saudacao').innerText = `Olá, ${user.displayName || 'Paulo'}`;
        
        // Esconde o botão de "Novo Projeto" se não for gestor
        const btnNovo = document.querySelector('button[onclick="showSection(\'novo-projeto\')"]');
        if(btnNovo) btnNovo.style.display = isManager ? 'inline-block' : 'none';
        
        // Força ir para a tela de acompanhamento ao logar
        showSection('acompanhamento');
        loadData();
    } else {
        document.getElementById('login-screen').style.display = 'flex';
        document.getElementById('app-screen').style.display = 'none';
    }
});

document.getElementById('login-btn').onclick = () => auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
function logout() { auth.signOut(); }

// 5. CARREGAMENTO DE DADOS
function loadData() {
    db.collection('tarefas').onSnapshot(snapshot => {
        allTasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderBoard();
        renderDashboard();
    });
}

// Função auxiliar para filtrar o que o usuário pode ver
function getVisibleTasks() {
    if (MANAGERS.includes(currentUserEmail)) return allTasks; // Gestor vê tudo
    
    // Participante vê só o que é dele
    return allTasks.filter(t => {
        if (t.resps && t.resps.length > 0) {
            return t.resps.some(r => r.email === currentUserEmail);
        }
        return t.email === currentUserEmail; // Garantia para tarefas antigas
    });
}

function updateProjectList(tasksToRender) {
    const list = document.getElementById('projectsList');
    const filter = document.getElementById('filterProject');
    const projects = [...new Set(tasksToRender.map(t => t.project))];
    
    if(list) list.innerHTML = projects.map(p => `<option value="${p}">`).join('');
    
    if(filter) {
        filter.innerHTML = '<option value="geral">Visão Geral</option>' + projects.map(p => `<option value="${p}">${p}</option>`).join('');
    }
}

// 6. SALVAR DEMANDA (MANTIDO INTACTO)
async function saveDemand() {
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
        emailjs.send("service_yw91uty", "template_p5wyzq8", { // Suas chaves originais
            responsavel: r.nome,
            projeto: project,
            email_to: r.email 
        }).then(() => console.log("E-mail enviado para " + r.nome))
          .catch(err => console.error("Erro no e-mail", err));
    });

    alert("Demanda lançada e e-mail enviado!");
    document.getElementById('taskTitle').value = "";
    document.getElementById('taskDesc').value = "";
    showSection('acompanhamento');
}

// 7. DASHBOARD E QUADRO (AGORA FILTRADOS)
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
    
    const visibleTasks = getVisibleTasks(); // O pulo do gato está aqui

    if(visibleTasks.length === 0) {
        board.innerHTML = '<p style="text-align:center; padding:20px;">Você não possui tarefas pendentes no momento.</p>';
        return;
    }

    const grouped = visibleTasks.reduce((acc, t) => {
        if (!acc[t.project]) acc[t.project] = [];
        acc[t.project].push(t);
        return acc;
    }, {});

    for (const [proj, tasks] of Object.entries(grouped)) {
        let html = `<div class="project-card" style="margin-bottom:15px; border:1px solid #ddd; padding:10px; border-radius:8px;">
            <h4 style="background:#1e293b; color:white; padding:8px; border-radius:4px; margin-bottom:10px;">📁 ${proj}</h4>`;
        
        tasks.forEach(t => {
            const nomeResp = t.resps && t.resps.length > 0 ? t.resps[0].nome : (t.responsavel || "Não atribuído");
            html += `<div class="task-item" onclick="abrirModal('${t.id}')" style="cursor:pointer; padding:8px; border-bottom:1px solid #eee;">
                <strong>${t.text}</strong> <small>(${nomeResp})</small>
                <span style="float:right; font-size:0.8rem; background:#e2e8f0; padding:2px 6px; border-radius:4px;">${t.status.toUpperCase()}</span>
            </div>`;
        });
        
        html += `</div>`;
        board.innerHTML += html;
    }
}

// 8. MODAL DE GESTÃO E EXCLUSÃO
async function abrirModal(id) {
    currentTaskId = id;
    const t = allTasks.find(x => x.id === id);
    document.getElementById('taskModal').style.display = 'block';
    document.getElementById('editTitle').value = t.text;
    document.getElementById('editDesc').value = t.descricao || "";
    document.getElementById('editDate').value = t.date !== "Sem prazo" ? t.date : "";
    document.getElementById('editStatus').value = t.status;
    document.getElementById('modalHistorico').innerHTML = (t.historico || []).map(h => `<div>[${h.data}] ${h.texto}</div>`).join('');
    
    // Proteção: Somente o gestor pode ver o botão de excluir
    const btnExcluir = document.querySelector('button[onclick="deleteTask()"]');
    if (btnExcluir) {
        btnExcluir.style.display = MANAGERS.includes(currentUserEmail) ? 'inline-block' : 'none';
    }
}

function closeModal() { document.getElementById('taskModal').style.display = 'none'; }

async function saveModalChanges() {
    const update = {
        text: document.getElementById('editTitle').value,
        descricao: document.getElementById('editDesc').value,
        date: document.getElementById('editDate').value || "Sem prazo",
        status: document.getElementById('editStatus').value,
        historico: firebase.firestore.FieldValue.arrayUnion({ 
            data: new Date().toLocaleDateString(), 
            texto: `Alterado por ${currentUserEmail}` 
        })
    };
    await db.collection('tarefas').doc(currentTaskId).update(update);
    alert("Tarefa atualizada!");
    closeModal();
}

async function deleteTask() {
    if(!MANAGERS.includes(currentUserEmail)) return; // Trava de segurança extra
    if(confirm("Deseja realmente EXCLUIR esta demanda? Esta ação é irreversível.")) {
        await db.collection('tarefas').doc(currentTaskId).delete();
        alert("Demanda excluída.");
        closeModal();
    }
}