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

// VARIÁVEIS GLOBAIS DA OBRA
let allTasks = [];
let chartInstance = null;
let currentTaskId = null;
let currentUserEmail = null; 
let currentUserRole = null; // Guarda o crachá do usuário (super-admin, gestor, executor)

// 2. NAVEGAÇÃO E UI
function showSection(sec) {
    document.querySelectorAll('.content-section').forEach(s => s.style.display = 'none');
    document.getElementById(`sec-${sec}`).style.display = 'block';
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
            // Bate no Firebase: "Esse e-mail está na lista de convidados autorizados?"
            const userQuery = await db.collection('usuarios').where('email', '==', currentUserEmail).get();
            
            if (userQuery.empty) {
                // Não tem cadastro. Expulsa.
                alert("Acesso Negado: Você não faz parte desta equipe ou não foi cadastrado pelo Coordenador.");
                auth.signOut();
                return;
            }

            // Tem cadastro. Lê o papel.
            const userData = userQuery.docs[0].data();
            currentUserRole = userData.papel;

            // Libera a interface básica
            document.getElementById('login-screen').style.display = 'none';
            document.getElementById('app-screen').style.display = 'block';
            document.getElementById('saudacao').innerText = `Olá, ${userData.nome || 'Usuário'} (${currentUserRole.toUpperCase()})`;
            
            // Controle Básico de Visão: Só admin e gestor criam projetos
            const btnNovo = document.querySelector('button[onclick="showSection(\'novo-projeto\')"]');
            if(btnNovo) {
                btnNovo.style.display = (currentUserRole === 'super-admin' || currentUserRole === 'gestor') ? 'inline-block' : 'none';
            }
            
            showSection('acompanhamento');
            loadData();
            
        } catch (error) {
            console.error("Erro na catraca de segurança:", error);
            alert("Erro ao validar credenciais. Contate o suporte.");
            auth.signOut();
        }
    } else {
        // Ninguém logado
        document.getElementById('login-screen').style.display = 'flex';
        document.getElementById('app-screen').style.display = 'none';
        currentUserEmail = null;
        currentUserRole = null;
    }
});

document.getElementById('login-btn').onclick = () => auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
function logout() { auth.signOut(); }

// 4. CARREGAMENTO DE DADOS E FILTROS DINÂMICOS
function loadData() {
    db.collection('tarefas').onSnapshot(snapshot => {
        allTasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderDashboard();
        renderBoard();
    });
}

// Filtra o que o usuário logado tem permissão para ver
function getVisibleTasks() {
    if (currentUserRole === 'super-admin' || currentUserRole === 'gestor') return allTasks; // Alta patente vê tudo
    
    // Executor vê só o que foi delegado a ele
    return allTasks.filter(t => {
        if (t.resps && t.resps.length > 0) {
            return t.resps.some(r => r.email === currentUserEmail);
        }
        return t.email === currentUserEmail; // Garantia para tarefas do formato antigo
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

// 5. SALVAR DEMANDA E DISPARAR E-MAIL (EMAILJS MANTIDO INTACTO)
async function saveDemand() {
    // Bloqueio extra no motor (caso o executor burle o visual)
    if (currentUserRole !== 'super-admin' && currentUserRole !== 'gestor') {
        alert("Ação não permitida: Apenas gestores podem criar demandas.");
        return;
    }

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

// 6. DASHBOARD E QUADRO DE TAREFAS (COM VISÃO FILTRADA)
function renderDashboard() {
    const visibleTasks = getVisibleTasks();
    updateProjectList(visibleTasks);

    const selected = document.getElementById('filterProject').value;
    const filtered = selected === 'geral' ? visibleTasks : visibleTasks.filter(t => t.project === selected);
    
    const stats = {
        total: filtered.length,
        atrasadas: filtered.filter(t => t.status !== 'aprovacao' && t.date !== "Sem prazo" && new Date(t.date) < new Date()).length,
        pendentes: filtered.filter(t => t.status === 'aprovacao').length,
        concluidas: filtered.filter(t => t.status === 'aprovacao').length // Na Fase 3 separaremos pendente de concluída real
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

// 7. MODAL DE GESTÃO E EXCLUSÃO (BLOQUEIO DE BOTÕES POR PAPEL)
async function abrirModal(id) {
    currentTaskId = id;
    const t = allTasks.find(x => x.id === id);
    document.getElementById('taskModal').style.display = 'block';
    document.getElementById('editTitle').value = t.text;
    document.getElementById('editDesc').value = t.descricao || "";
    document.getElementById('editDate').value = t.date !== "Sem prazo" ? t.date : "";
    document.getElementById('editStatus').value = t.status;
    document.getElementById('modalHistorico').innerHTML = (t.historico || []).map(h => `<div>[${h.data}] ${h.texto}</div>`).join('');
    
    // Oculta o botão de excluir se for um mero executor
    const btnExcluir = document.querySelector('button[onclick="deleteTask()"]');
    if (btnExcluir) {
        btnExcluir.style.display = (currentUserRole === 'super-admin' || currentUserRole === 'gestor') ? 'inline-block' : 'none';
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
    // Trava de segurança no backend-side (script)
    if(currentUserRole !== 'super-admin' && currentUserRole !== 'gestor') return; 

    if(confirm("Deseja realmente EXCLUIR esta demanda? Esta ação é irreversível.")) {
        await db.collection('tarefas').doc(currentTaskId).delete();
        alert("Demanda excluída.");
        closeModal();
    }
}