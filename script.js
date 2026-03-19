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
    div.innerHTML = `<input type="text" class="resp-name" placeholder="Nome"><input type="email" class="resp-email" placeholder="E-mail">`;
    container.appendChild(div);
}

// AUTH
auth.onAuthStateChanged(user => {
    if (user) {
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('app-screen').style.display = 'block';
        document.getElementById('saudacao').innerText = `Olá, ${user.displayName || 'Paulo'}`;
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
    filter.innerHTML = '<option value="geral">Visão Geral</option>' + projects.map(p => `<option value="${p}">${p}</option>`).join('');
}

// SALVAR NOVA DEMANDA (CORRIGIDO)
async function saveDemand() {
    const project = document.getElementById('projectInput').value;
    const title = document.getElementById('taskTitle').value; // Aqui estava o erro do print
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
    
    // Notificar Render
    resps.forEach(r => {
       resps.forEach(r => {
    emailjs.send("service_yw91uty", "template_p5wyzq8", {
        responsavel: r.nome,
        projeto: project,
        email_to: r.email // Certifique-se de configurar a variável de destino no template do EmailJS para usar {{email_to}}
    }).then(() => console.log("E-mail enviado para " + r.nome))
      .catch(err => console.error("Erro no e-mail", err));
});

// DASHBOARD
function renderDashboard() {
    const selected = document.getElementById('filterProject').value;
    const filtered = selected === 'geral' ? allTasks : allTasks.filter(t => t.project === selected);
    
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
    tasks.forEach(t => s[t.status]++);
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
    const grouped = allTasks.reduce((acc, t) => {
        if (!acc[t.project]) acc[t.project] = [];
        acc[t.project].push(t);
        return acc;
    }, {});

    for (const [proj, tasks] of Object.entries(grouped)) {
        let html = `<div class="project-card" style="margin-bottom:15px; border:1px solid #ddd; padding:10px; border-radius:8px;">
            <h4 style="background:#1e293b; color:white; padding:8px; border-radius:4px; margin-bottom:10px;">📁 ${proj}</h4>`;
        
        tasks.forEach(t => {
            // BLINDAGEM: Se a tarefa for nova, usa o array. Se for velha, usa o texto antigo.
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

// MODAL DE GESTÃO (EDITAR / EXCLUIR)
async function abrirModal(id) {
    currentTaskId = id;
    const t = allTasks.find(x => x.id === id);
    document.getElementById('taskModal').style.display = 'block';
    document.getElementById('editTitle').value = t.text;
    document.getElementById('editDesc').value = t.descricao || "";
    document.getElementById('editDate').value = t.date !== "Sem prazo" ? t.date : "";
    document.getElementById('editStatus').value = t.status;
    document.getElementById('modalHistorico').innerHTML = (t.historico || []).map(h => `<div>[${h.data}] ${h.texto}</div>`).join('');
}

function closeModal() { document.getElementById('taskModal').style.display = 'none'; }

async function saveModalChanges() {
    const update = {
        text: document.getElementById('editTitle').value,
        descricao: document.getElementById('editDesc').value,
        date: document.getElementById('editDate').value || "Sem prazo",
        status: document.getElementById('editStatus').value,
        historico: firebase.firestore.FieldValue.arrayUnion({ data: new Date().toLocaleDateString(), texto: "Alterado pelo Gestor" })
    };
    await db.collection('tarefas').doc(currentTaskId).update(update);
    alert("Tarefa atualizada!");
    closeModal();
}

async function deleteTask() {
    if(confirm("Deseja realmente EXCLUIR esta demanda? Esta ação é irreversível.")) {
        await db.collection('tarefas').doc(currentTaskId).delete();
        alert("Demanda excluída.");
        closeModal();
    }
}