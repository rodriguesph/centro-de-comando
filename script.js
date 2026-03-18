import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import { getFirestore, collection, addDoc, onSnapshot, deleteDoc, doc, updateDoc, query, orderBy } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

// A sua configuração real (Exposta, mas funcional para este MVP)
const firebaseConfig = {
    apiKey: "AIzaSyC4utmTe19lRJdOJutVmJAdhkfeu4znkpI",
    authDomain: "centrodecomando-paulo.firebaseapp.com",
    projectId: "centrodecomando-paulo",
    storageBucket: "centrodecomando-paulo.firebasestorage.app",
    messagingSenderId: "949266387673",
    appId: "1:949266387673:web:1ca08986cac568a76f64c8",
    measurementId: "G-QE62CLW6GS"
};

// Inicializar Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

// Elementos da UI
const loginScreen = document.getElementById('login-screen');
const appScreen = document.getElementById('app-screen');
const userInfo = document.getElementById('user-info');
const board = document.getElementById('projectsBoard');

// Controle de Autenticação em Tempo Real
onAuthStateChanged(auth, (user) => {
    if (user) {
        loginScreen.style.display = 'none';
        appScreen.style.display = 'block';
        userInfo.textContent = `Logado como: ${user.email}`;
        loadTasks(); // Só puxa os dados se estiver autenticado
    } else {
        loginScreen.style.display = 'block';
        appScreen.style.display = 'none';
    }
});

// Botões de Login e Logout
document.getElementById('login-btn').addEventListener('click', () => {
    signInWithPopup(auth, provider).catch(error => {
        alert("Erro no login. Você ativou o provedor do Google no painel do Firebase? Erro original: " + error.message);
    });
});

document.getElementById('logout-btn').addEventListener('click', () => {
    signOut(auth);
});

// Adicionar Tarefa no Servidor
document.getElementById('add-task-btn').addEventListener('click', async () => {
    const area = document.getElementById('areaSelect').value;
    const project = document.getElementById('projectInput').value.trim();
    const text = document.getElementById('taskInput').value.trim();
    const resp = document.getElementById('respInput').value.trim() || 'Eu';
    const email = document.getElementById('emailInput').value.trim();
    const dateInput = document.getElementById('dateInput').value;

    if (!project || !text) {
        alert('Pare de preguiça. O Nome do Projeto e o Nome da Tarefa são obrigatórios.');
        return;
    }

    const dateFormatted = dateInput ? new Date(dateInput + 'T00:00:00').toLocaleDateString('pt-BR') : 'Sem prazo';

    try {
        await addDoc(collection(db, "tarefas"), {
            area: area,
            project: project,
            text: text,
            responsavel: resp,
            email: email,
            date: dateFormatted,
            rawDate: dateInput || '9999-12-31',
            status: 'fazer',
            criadoPor: auth.currentUser.email,
            timestamp: Date.now()
        });
        
        // Limpar campos após enviar
        document.getElementById('taskInput').value = '';
        document.getElementById('respInput').value = '';
        document.getElementById('emailInput').value = '';
    } catch (e) {
        alert("Erro ao gravar no banco. Você criou o Firestore em 'Modo de Teste'? Erro original: " + e.message);
    }
});

// Escutar o Banco de Dados em Tempo Real
function loadTasks() {
    const q = query(collection(db, "tarefas"), orderBy("rawDate"));
    
    onSnapshot(q, (snapshot) => {
        const tasks = [];
        snapshot.forEach((doc) => {
            tasks.push({ id: doc.id, ...doc.data() });
        });
        renderBoard(tasks);
    });
}

// Atualizar Status direto no Servidor
window.updateStatus = async function(id, newStatus) {
    try {
        const taskRef = doc(db, "tarefas", id);
        await updateDoc(taskRef, { status: newStatus });
    } catch (e) {
        alert("Erro ao atualizar o status: " + e.message);
    }
}

// Deletar do Servidor
window.deleteTask = async function(id) {
    if(confirm('Tem certeza? Isso apaga a tarefa permanentemente do servidor para todo mundo.')) {
        try {
            await deleteDoc(doc(db, "tarefas", id));
        } catch (e) {
            alert("Erro ao deletar: " + e.message);
        }
    }
}

// Disparador de E-mail (Via cliente de e-mail local)
window.sendEmail = function(taskText, project, responsavel, email, date) {
    if (!email) {
        alert('Você não cadastrou o e-mail desse responsável.');
        return;
    }
    const subject = encodeURIComponent(`Nova Tarefa Atribuída: ${project}`);
    const body = encodeURIComponent(`Olá ${responsavel},\n\nVocê tem uma nova pendência no projeto "${project}".\n\nTarefa: ${taskText}\nPrazo Final: ${date}\n\nAtualize o status da atividade assim que possível.\n\nAtenciosamente,\n${auth.currentUser.displayName || 'Paulo'}`);
    window.open(`mailto:${email}?subject=${subject}&body=${body}`);
}

// Renderizar a Interface
function renderBoard(tasks) {
    board.innerHTML = '';
    
    // Agrupamento lógico por projetos
    const grouped = tasks.reduce((acc, task) => {
        if (!acc[task.project]) acc[task.project] = { area: task.area, tasks: [] };
        acc[task.project].tasks.push(task);
        return acc;
    }, {});

    for (const [projectName, data] of Object.entries(grouped)) {
        const projectDiv = document.createElement('div');
        projectDiv.className = 'project-card';
        
        let tasksHtml = data.tasks.map(task => `
            <div class="task-item">
                <div class="task-info">
                    <strong>${task.text}</strong>
                    <div class="task-meta">
                        👤 Resp: <b>${task.responsavel}</b> 
                        <span class="deadline">Prazo: ${task.date}</span>
                    </div>
                </div>
                <div class="task-actions">
                    <select class="status-select status-${task.status}" onchange="updateStatus('${task.id}', this.value)">
                        <option value="fazer" ${task.status === 'fazer' ? 'selected' : ''}>A Fazer</option>
                        <option value="andamento" ${task.status === 'andamento' ? 'selected' : ''}>Em Andamento</option>
                        <option value="aprovacao" ${task.status === 'aprovacao' ? 'selected' : ''}>Aguardando Meu OK</option>
                    </select>
                    <button class="btn btn-email" onclick="sendEmail('${task.text}', '${projectName}', '${task.responsavel}', '${task.email}', '${task.date}')">✉️ Notificar</button>
                    <button class="btn btn-delete" onclick="deleteTask('${task.id}')">✖</button>
                </div>
            </div>
        `).join('');

        projectDiv.innerHTML = `
            <div class="project-header">
                <span class="project-title">📁 ${projectName}</span>
                <span class="project-area">${data.area}</span>
            </div>
            <div class="project-tasks">${tasksHtml}</div>
        `;
        board.appendChild(projectDiv);
    }
}