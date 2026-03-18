// CONFIGURAÇÃO DO FIREBASE (MANTENHA AS SUAS CHAVES AQUI)
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
const auth = firebase.auth();
const db = firebase.firestore();
let myChart = null;

// CONTROLE DE LOGIN
auth.onAuthStateChanged(async (user) => {
    if (user) {
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('app-screen').style.display = 'block';
        document.getElementById('user-email').innerText = user.email;
        checkAdmin(user.email);
        loadTasks(user.email);
    } else {
        document.getElementById('login-screen').style.display = 'flex';
        document.getElementById('app-screen').style.display = 'none';
    }
});

document.getElementById('login-btn').onclick = () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider);
};

function logout() { auth.signOut(); }

// VERIFICAR SE É ADMIN (PAULO)
async function checkAdmin(email) {
    const doc = await db.collection('usuarios').doc(email).get();
    if (doc.exists && doc.data().papel === 'admin') {
        document.getElementById('admin-input').style.display = 'block';
        document.getElementById('dashboard-section').style.display = 'block';
        window.isAdmin = true;
    }
}

// ADICIONAR TAREFA (E MANDAR E-MAIL VIA BACKEND)
async function addTask() {
    const area = document.getElementById('areaSelect').value;
    const project = document.getElementById('projectInput').value;
    const task = document.getElementById('taskInput').value;
    const email = document.getElementById('emailInput').value;
    const resp = document.getElementById('respInput').value;
    const date = document.getElementById('dateInput').value;

    if (!project || !task || !email) return alert("Preencha os campos obrigatórios.");

    const docRef = await db.collection('tarefas').add({
        area, project, text: task, email, responsavel: resp, 
        date: date || "Sem prazo", status: 'fazer', criadoEm: new Date(), historico: []
    });

    // Chamada ao seu servidor Local (Fase 3) para disparar e-mail
    fetch('http://localhost:3000/enviar-convite', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ email, projeto: project, responsavel: resp })
    }).catch(e => console.log("Backend offline, e-mail não enviado."));

    alert("Tarefa Delegada!");
}

// CARREGAR TAREFAS EM TEMPO REAL
function loadTasks(userEmail) {
    db.collection('tarefas').onSnapshot(snapshot => {
        const tasks = [];
        snapshot.forEach(doc => tasks.push({ id: doc.id, ...doc.data() }));
        renderBoard(tasks);
        if (window.isAdmin) updateDashboard(tasks);
    });
}

function renderBoard(tasks) {
    const board = document.getElementById('projectsBoard');
    board.innerHTML = '';
    
    // Agrupar por projeto
    const grouped = tasks.reduce((acc, t) => {
        if (!acc[t.project]) acc[t.project] = [];
        acc[t.project].push(t);
        return acc;
    }, {});

    for (const [proj, items] of Object.entries(grouped)) {
        let html = `<div class="project-card"><h3>📁 ${proj}</h3>`;
        items.forEach(t => {
            html += `
            <div class="task-item" onclick="abrirModal('${t.id}')" style="cursor:pointer">
                <div><strong>${t.text}</strong><br><small>👤 ${t.responsavel} - ${t.status}</small></div>
                <div class="task-meta">${t.date}</div>
            </div>`;
        });
        html += `</div>`;
        board.innerHTML += html;
    }
}

// MODAL E HISTÓRICO
async function abrirModal(id) {
    window.currentTaskId = id;
    const doc = await db.collection('tarefas').doc(id).get();
    const data = doc.data();
    
    document.getElementById('modal-detalhes').style.display = 'block';
    document.getElementById('modal-titulo').innerText = data.text;
    document.getElementById('modal-status-txt').innerText = data.status.toUpperCase();
    document.getElementById('modal-desc').value = data.descricao || "";
    
    const histDiv = document.getElementById('modal-historico');
    histDiv.innerHTML = (data.historico || []).map(h => `<div><b>${h.data}:</b> ${h.texto}</div>`).join('');
}

function fecharModal() { document.getElementById('modal-detalhes').style.display = 'none'; }

async function salvarUpdate() {
    const desc = document.getElementById('modal-desc').value;
    const novoH = { data: new Date().toLocaleDateString(), texto: desc };
    
    await db.collection('tarefas').doc(window.currentTaskId).update({
        descricao: desc,
        historico: firebase.firestore.FieldValue.arrayUnion(novoH),
        status: 'andamento' // Muda status automaticamente ao reportar
    });
    alert("Report enviado!");
    fecharModal();
}

// DASHBOARD (CHART.JS)
function updateDashboard(tasks) {
    const stats = { fazer: 0, andamento: 0, aprovacao: 0 };
    tasks.forEach(t => stats[t.status] = (stats[t.status] || 0) + 1);

    const ctx = document.getElementById('statusChart').getContext('2d');
    if (myChart) myChart.destroy();
    myChart = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: ['A Fazer', 'Em Andamento', 'Aguardando OK'],
            datasets: [{ data: [stats.fazer, stats.andamento, stats.aprovacao], backgroundColor: ['#ff6384', '#ffcd56', '#36a2eb'] }]
        }
    });
}