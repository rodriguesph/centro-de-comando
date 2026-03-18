// CONFIGURAÇÃO DO FIREBASE (Mantenha as chaves que você já tem)
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
let allTasks = [];
let chartInstance = null;
let currentTaskId = null;

// NAVEGAÇÃO
function showSection(sec) {
    document.querySelectorAll('.content-section').forEach(s => s.style.display = 'none');
    document.getElementById(`sec-${sec}`).style.display = 'block';
}

function addResponsavelField() {
    const container = document.getElementById('responsaveis-container');
    const div = document.createElement('div');
    div.className = 'resp-row';
    div.style = "display: flex; gap: 5px; margin-bottom: 5px;";
    div.innerHTML = `<input type="text" class="resp-name" placeholder="Nome" style="flex:1"><input type="email" class="resp-email" placeholder="E-mail" style="flex:1">`;
    container.appendChild(div);
}

// LOGIN E DADOS
auth.onAuthStateChanged(user => {
    if (user) {
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('app-screen').style.display = 'block';
        document.getElementById('saudacao').innerText = `Olá, ${user.displayName || 'Gestor'}`;
        loadData();
    } else {
        document.getElementById('login-screen').style.display = 'flex';
        document.getElementById('app-screen').style.display = 'none';
    }
});

document.getElementById('login-btn').onclick = () => auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
function logout() { auth.signOut(); }

function loadData() {
    db.collection('tarefas').onSnapshot(snapshot => {
        allTasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        updateProjectList();
        renderBoard();
        renderDashboard();
    });
}

function updateProjectList() {
    const list = document.getElementById('projectsList');
    const filter = document.getElementById('filterProject');
    const projects = [...new Set(allTasks.map(t => t.project))];
    
    list.innerHTML = projects.map(p => `<option value="${p}">`).join('');
    filter.innerHTML = '<option value="geral">Visão Geral (Todos os Projetos)</option>' + 
                       projects.map(p => `<option value="${p}">${p}</option>`).join('');
}

// SALVAR NOVA DEMANDA
async function saveDemand() {
    const project = document.getElementById('projectInput').value;
    const title = document.getElementById('taskTitle').value;
    const desc = document.getElementById('taskDesc').value;
    const date = document.getElementById('dateInput').value;
    
    const resps = Array.from(document.querySelectorAll('.resp-row')).map(row => ({
        nome: row.querySelector('.resp-name').value,
        email: row.querySelector('.resp-email').value.toLowerCase().trim()
    })).filter(r => r.email !== "");

    if(!project || !title || resps.length === 0) return alert("Erro: Projeto, Título e Responsável são obrigatórios.");

    const taskData = {
        project, text: title, descricao: desc, date: date || "Sem prazo",
        resps, status: 'fazer', criadoEm: new Date(), historico: [],
        email: resps[0].email // Compatibilidade com regras de segurança
    };

    await db.collection('tarefas').add(taskData);
    
    // Notificar via Backend (Loop de responsáveis)
    resps.forEach(r => {
        fetch('http://localhost:3000/enviar-convite', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ email: r.email, projeto: project, responsavel: r.nome })
        }).catch(e => console.log("Backend offline"));
    });

    alert("Demanda delegada com sucesso!");
    showSection('acompanhamento');
}

// RENDERIZAÇÃO DO DASHBOARD E FILTROS
function renderDashboard() {
    const selected = document.getElementById('filterProject').value;
    const filtered = selected === 'geral' ? allTasks : allTasks.filter(t => t.project === selected);
    
    const total = filtered.length;
    const atrasadas = filtered.filter(t => {
        if (t.status === 'aprovacao' || t.date === "Sem prazo") return false;
        return new Date(t.date) < new Date();
    }).length;
    const pendentesOK = filtered.filter(t => t.status === 'aprovacao').length;
    const concluidas = filtered.filter(t => t.status === 'aprovacao').length; // Supondo que OK do gestor = Concluído
    const percentual = total > 0 ? Math.round((concluidas / total) * 100) : 0;

    const grid = document.getElementById('stats-grid');
    grid.innerHTML = `
        <div style="background:#eee;padding:10px;border-radius:5px;text-align:center"><strong>${total}</strong><br><small>Tarefas</small></div>
        <div style="background:#ffebee;padding:10px;border-radius:5px;text-align:center;color:red"><strong>${atrasadas}</strong><br><small>Atrasadas</small></div>
        <div style="background:#e3f2fd;padding:10px;border-radius:5px;text-align:center;color:blue"><strong>${pendentesOK}</strong><br><small>Pendentes OK</small></div>
        <div style="background:#e8f5e9;padding:10px;border-radius:5px;text-align:center"><strong>${percentual}%</strong><br><small>Conclusão</small></div>
    `;

    // Lógica de Risco
    const riscoBox = document.getElementById('riscos-alerta');
    if (selected !== 'geral') {
        const risco = atrasadas > (total * 0.3) ? {cor: '#ffcdd2', txt: 'ALTO: Mais de 30% de atraso.'} : {cor: '#c8e6c9', txt: 'BAIXO: Cronograma em dia.'};
        riscoBox.style.background = risco.cor;
        riscoBox.innerHTML = `<strong>Risco do Projeto:</strong> ${risco.txt}`;
        riscoBox.style.display = 'block';
    } else { riscoBox.style.display = 'none'; }

    updateChart(filtered);
}

function updateChart(tasks) {
    const stats = { fazer: 0, andamento: 0, aprovacao: 0 };
    tasks.forEach(t => stats[t.status] = (stats[t.status] || 0) + 1);

    const ctx = document.getElementById('mainChart').getContext('2d');
    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['A Fazer', 'Em Andamento', 'OK Gestor'],
            datasets: [{ data: [stats.fazer, stats.andamento, stats.aprovacao], backgroundColor: ['#ef4444', '#f59e0b', '#10b981'] }]
        }
    });
}

function renderBoard() {
    const board = document.getElementById('projectsBoard');
    board.innerHTML = '';
    const grouped = allTasks.reduce((acc, t) => {
        if (!acc[t.project]) acc[t.project] = [];
        acc[t.project].push(t);
        return acc;
    }, {});

    for (const [proj, tasks] of Object.entries(grouped)) {
        let html = `<div class="project-card" style="margin-bottom:15px; border:1px solid #ddd; padding:10px; border-radius:8px;">
            <h4 style="background:#333; color:white; padding:5px; border-radius:4px;">📁 ${proj} (${tasks.length} tarefas)</h4>`;
        tasks.forEach(t => {
            html += `<div onclick="abrirModal('${t.id}')" style="cursor:pointer; padding:8px; border-bottom:1px solid #eee;">
                <strong>${t.text}</strong> <small>(${t.responsavel || t.resps[0].nome})</small>
                <span style="float:right; font-size:0.7rem;">${t.status}</span>
            </div>`;
        });
        html += `</div>`;
        board.innerHTML += html;
    }
}

// MODAL E EDIÇÃO
async function abrirModal(id) {
    currentTaskId = id;
    const task = allTasks.find(t => t.id === id);
    document.getElementById('taskModal').style.display = 'block';
    document.getElementById('modalTitle').innerText = task.text;
    document.getElementById('modalInfo').innerText = `Projeto: ${task.project} | Prazo: ${task.date}`;
    document.getElementById('modalDesc').value = task.descricao || "";
    document.getElementById('modalHistorico').innerHTML = (task.historico || []).map(h => `<div>[${h.data}] ${h.texto}</div>`).join('');
}

function closeModal() { document.getElementById('taskModal').style.display = 'none'; }

async function saveModalChanges() {
    const desc = document.getElementById('modalDesc').value;
    const log = { data: new Date().toLocaleDateString(), texto: "Report: " + desc.substring(0, 30) + "..." };
    await db.collection('tarefas').doc(currentTaskId).update({
        descricao: desc,
        historico: firebase.firestore.FieldValue.arrayUnion(log),
        status: 'andamento'
    });
    alert("Dados salvos!");
    closeModal();
}

async function updateTaskStatus(novoStatus) {
    await db.collection('tarefas').doc(currentTaskId).update({ status: novoStatus });
    alert("Status atualizado!");
    closeModal();
}