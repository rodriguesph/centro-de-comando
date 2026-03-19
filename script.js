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

// 1. POPULA OS SELECTS DE RESPONSÁVEL COM DADOS REAIS DO BANCO
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
                alert("Acesso Negado: Você não faz parte desta equipe ou não foi cadastrado pelo Coordenador.");
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
            
            showSection('acompanhamento');
            loadData();
            loadUsersDatabase(); // Todos precisam ler a lista de usuários agora para o select funcionar
            
        } catch (error) {
            console.error(error);
            alert("Erro ao validar credenciais.");
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
        populateUserSelects(); // Atualiza os selects de formulário
        if(document.getElementById('sec-usuarios').style.display === 'block') renderUsers();
    });
}

// 2. DISPARO EM FILA SEQUENCIAL PARA EVITAR BLOQUEIO DE SPAM
async function saveDemand() {
    if (currentUserRole !== 'super-admin' && currentUserRole !== 'gestor') return;

    const project = document.getElementById('projectInput').value;
    const title = document.getElementById('taskTitle').value; 
    const desc = document.getElementById('taskDesc').value;
    const date = document.getElementById('dateInput').value;
    const area = document.getElementById('areaSelect').value;
    
    const resps = [];
    document.querySelectorAll('.resp-select').forEach(sel => {
        if(sel.value) {
            const userObj = allUsers.find(u => u.email === sel.value);
            // Evita adicionar o mesmo cara duas vezes
            if(userObj && !resps.find(r => r.email === userObj.email)) {
                resps.push({ nome: userObj.nome, email: userObj.email });
            }
        }
    });

    if(!project || !title || resps.length === 0) {
        alert("Erro: Projeto, Título e Responsável (selecionado da lista) são obrigatórios.");
        return;
    }

    const taskData = {
        project, text: title, descricao: desc, date: date || "Sem prazo",
        area, resps, status: 'fazer', criadoEm: new Date(), historico: [],
        email: resps[0].email // Legado
    };

    await db.collection('tarefas').add(taskData);
    
    // A MÁGICA DA FILA: Um e-mail espera o outro enviar antes de disparar
    alert("Salvando demanda e disparando notificações. Aguarde...");
    for (const r of resps) {
        try {
            await emailjs.send("service_yw91uty", "template_p5wyzq8", {
                responsavel: r.nome,
                projeto: project,
                email_to: r.email 
            });
            console.log(`E-mail enviado para ${r.nome}`);
        } catch (error) {
            console.error(`Falha no e-mail para ${r.nome}`, error);
        }
    }

    alert("Demanda lançada e TODA a equipe notificada com sucesso!");
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

function updateProjectList(tasksToRender) {
    const list = document.getElementById('projectsList');
    const filter = document.getElementById('filterProject');
    const projects = [...new Set(tasksToRender.map(t => t.project))];
    if(list) list.innerHTML = projects.map(p => `<option value="${p}">`).join('');
    if(filter) filter.innerHTML = '<option value="geral">Visão Geral</option>' + projects.map(p => `<option value="${p}">${p}</option>`).join('');
}

// 3. ATUALIZAÇÃO DO DASHBOARD PARA INCLUIR "CONCLUÍDO"
function renderDashboard() {
    const visibleTasks = getVisibleTasks();
    updateProjectList(visibleTasks);
    const selected = document.getElementById('filterProject').value;
    const filtered = selected === 'geral' ? visibleTasks : visibleTasks.filter(t => t.project === selected);
    
    const stats = {
        total: filtered.length,
        atrasadas: filtered.filter(t => t.status !== 'concluido' && t.status !== 'aprovacao' && t.date !== "Sem prazo" && new Date(t.date) < new Date()).length,
        pendentes: filtered.filter(t => t.status === 'aprovacao').length,
        concluidas: filtered.filter(t => t.status === 'concluido').length
    };

    document.getElementById('stats-grid').innerHTML = `
        <div class="stat-card"><h3>${stats.total}</h3><p>Tarefas</p></div>
        <div class="stat-card" style="color:red"><h3>${stats.atrasadas}</h3><p>Atrasadas</p></div>
        <div class="stat-card" style="color:blue"><h3>${stats.pendentes}</h3><p>Aguardando OK</p></div>
        <div class="stat-card" style="color:green"><h3>${stats.total > 0 ? Math.round((stats.concluidas/stats.total)*100) : 0}%</h3><p>Concluído Final</p></div>
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
            labels: ['Fazer', 'Andamento', 'OK do Gestor', 'Concluído'],
            datasets: [{ data: [s.fazer, s.andamento, s.aprovacao, s.concluido], backgroundColor: ['#ef4444', '#f59e0b', '#3b82f6', '#10b981'] }]
        }
    });
}

function renderBoard() {
    const board = document.getElementById('projectsBoard');
    board.innerHTML = '';
    const visibleTasks = getVisibleTasks();

    if(visibleTasks.length === 0) {
        board.innerHTML = '<p style="text-align:center; padding:20px; color:#64748b;">Nenhuma tarefa ativa.</p>';
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
            const nomeResp = t.resps && t.resps.length > 0 ? t.resps.map(r => r.nome.split(' ')[0]).join(', ') : "Não atribuído";
            const statusColor = t.status === 'concluido' ? 'background:#10b981; color:white;' : (t.status === 'aprovacao' ? 'background:#3b82f6; color:white;' : 'background:#e2e8f0;');
            
            html += `<div class="task-item" onclick="abrirModal('${t.id}')" style="cursor:pointer; padding:8px; border-bottom:1px solid #f1f5f9;">
                <strong>${t.text}</strong> <small style="color:#64748b;">(${nomeResp})</small>
                <span style="float:right; font-size:0.75rem; padding:4px 8px; border-radius:4px; font-weight:bold; ${statusColor}">${t.status.toUpperCase()}</span>
            </div>`;
        });
        html += `</div>`;
        board.innerHTML += html;
    }
}

// 4. MÁQUINA DE ESTADOS E MÓDULO DE REPORTS BLINDADO
async function abrirModal(id) {
    currentTaskId = id;
    const t = allTasks.find(x => x.id === id);
    document.getElementById('taskModal').style.display = 'block';
    
    const isGestor = (currentUserRole === 'super-admin' || currentUserRole === 'gestor');
    
    document.getElementById('editTitle').value = t.text;
    document.getElementById('editTitle').disabled = !isGestor;
    
    document.getElementById('editDate').value = t.date !== "Sem prazo" ? t.date : "";
    document.getElementById('editDate').disabled = !isGestor;
    
    // Escopo original blindado
    document.getElementById('editDesc').value = t.descricao || "Sem escopo inicial.";
    document.getElementById('editDesc').disabled = !isGestor; 
    
    // Limpa a caixa de novo report
    document.getElementById('newReport').value = ""; 
    
    // Controle rigoroso de Status
    const statusSelect = document.getElementById('editStatus');
    statusSelect.value = t.status;
    
    const optConcluido = document.getElementById('opt-concluido');
    if (optConcluido) optConcluido.style.display = isGestor ? 'block' : 'none';
    
    // Se já estiver concluído, executor não mexe mais em NADA.
    if (!isGestor && t.status === 'concluido') {
        statusSelect.disabled = true;
        document.getElementById('newReport').disabled = true;
        document.getElementById('newReport').placeholder = "Tarefa concluída. Apenas gestores podem reabrir.";
    } else {
        statusSelect.disabled = false;
        document.getElementById('newReport').disabled = false;
        document.getElementById('newReport').placeholder = "Adicionar novo reporte ou atualização (Ficará salvo no histórico)...";
    }

    // Renderiza Histórico (Estilo Chat)
    const histContainer = document.getElementById('modalHistorico');
    if(t.historico && t.historico.length > 0) {
        histContainer.innerHTML = t.historico.map(h => {
            const autor = h.autor || "Sistema";
            const dataStr = h.data || "";
            const texto = h.texto || h; 
            return `<div style="margin-bottom: 10px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">
                        <strong style="color:#0f172a;">👤 ${autor}</strong> <span style="font-size:0.75rem; color:#64748b; float:right;">${dataStr}</span><br>
                        <span style="color:#334155; margin-top:4px; display:block;">${texto}</span>
                    </div>`;
        }).join('');
    } else {
        histContainer.innerHTML = "<em style='color:#94a3b8;'>Nenhum reporte registrado ainda.</em>";
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
    
    const update = { status: newStatus };

    if(isGestor) {
        update.text = document.getElementById('editTitle').value;
        update.date = document.getElementById('editDate').value || "Sem prazo";
        update.descricao = document.getElementById('editDesc').value;
    }

    // Registra o Histórico Inviolável
    if(newReportText !== "") {
        update.historico = firebase.firestore.FieldValue.arrayUnion({
            data: new Date().toLocaleString('pt-BR'),
            autor: currentUserEmail,
            texto: newReportText
        });
    } else if (newStatus !== t.status) { 
        update.historico = firebase.firestore.FieldValue.arrayUnion({
            data: new Date().toLocaleString('pt-BR'),
            autor: "SISTEMA",
            texto: `Mudou o status de [${t.status.toUpperCase()}] para [${newStatus.toUpperCase()}] a mando de ${currentUserEmail.split('@')[0]}`
        });
    }

    await db.collection('tarefas').doc(currentTaskId).update(update);
    alert("Tarefa atualizada e registrada!");
    closeModal();
}

async function deleteTask() {
    if(currentUserRole !== 'super-admin' && currentUserRole !== 'gestor') return; 
    if(confirm("Deseja realmente EXCLUIR esta demanda? Esta ação é irreversível e apaga todo o histórico.")) {
        await db.collection('tarefas').doc(currentTaskId).delete();
        alert("Demanda excluída.");
        closeModal();
    }
}

// Funções do Admin
async function cadastrarUsuario() {
    if(currentUserRole !== 'super-admin') return;
    const nome = document.getElementById('novoUserNome').value.trim();
    const email = document.getElementById('novoUserEmail').value.toLowerCase().trim();
    const papel = document.getElementById('novoUserPapel').value;
    if(!nome || !email) return alert("Preencha Nome e E-mail.");
    if(allUsers.find(u => u.email === email)) return alert("E-mail já cadastrado.");
    await db.collection('usuarios').add({ nome, email, papel });
    alert("Usuário adicionado!");
    document.getElementById('novoUserNome').value = ""; document.getElementById('novoUserEmail').value = "";
}

async function removerUsuario(id, email) {
    if(currentUserRole !== 'super-admin') return;
    if(email === currentUserEmail) return alert("Você não pode se auto-excluir.");
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
        div.innerHTML = `<div><strong>${u.nome}</strong><br><small>${u.email} | Nível: <span style="font-weight:bold; color: ${u.papel === 'super-admin' ? 'red' : (u.papel === 'gestor' ? 'orange' : 'green')}">${u.papel.toUpperCase()}</span></small></div>
            ${u.email !== currentUserEmail ? `<button onclick="removerUsuario('${u.id}', '${u.email}')" class="btn-small" style="background:#ef4444;">Remover</button>` : '<span>(Você)</span>'}`;
        board.appendChild(div);
    });
}