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
let userBarChartInstance = null; // Novo motor do gráfico de barras
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
            
            showSection('acompanhamento');
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

function loadData() {
    db.collection('tarefas').onSnapshot(snapshot => {
        allTasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        // A CORREÇÃO DO FILTRO: Separamos a montagem da lista da renderização
        const visibleTasks = getVisibleTasks();
        updateProjectList(visibleTasks); 
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
            if(userObj && !resps.find(r => r.email === userObj.email)) {
                resps.push({ nome: userObj.nome, email: userObj.email });
            }
        }
    });

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
    
    alert("Salvando demanda e disparando notificações...");
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

// O NOVO MOTOR DO FILTRO QUE NÃO APAGA SUA SELEÇÃO
function updateProjectList(tasksToRender) {
    const list = document.getElementById('projectsList');
    const filter = document.getElementById('filterProject');
    const projects = [...new Set(tasksToRender.map(t => t.project))].sort();
    
    if(list) list.innerHTML = projects.map(p => `<option value="${p}">`).join('');
    
    if(filter) {
        const currentSelection = filter.value; // Salva o que você clicou
        let optionsHTML = '<option value="geral">Todos os Projetos</option>';
        projects.forEach(p => { optionsHTML += `<option value="${p}">${p}</option>`; });
        filter.innerHTML = optionsHTML;
        
        // Se o projeto que estava selecionado ainda existe, mantém ele.
        if (currentSelection && projects.includes(currentSelection)) {
            filter.value = currentSelection;
        } else {
            filter.value = 'geral';
        }
    }
}

// O MOTOR DO BUSINESS INTELLIGENCE
function renderDashboard() {
    const visibleTasks = getVisibleTasks();
    const selected = document.getElementById('filterProject').value;
    const filtered = selected === 'geral' ? visibleTasks : visibleTasks.filter(t => t.project === selected);
    
    // 1. CARDS DE KPI
    const stats = {
        total: filtered.length,
        atrasadas: filtered.filter(t => t.status !== 'concluido' && t.status !== 'aprovacao' && t.date !== "Sem prazo" && new Date(t.date) < new Date()).length,
        pendentes: filtered.filter(t => t.status === 'aprovacao').length,
        concluidas: filtered.filter(t => t.status === 'concluido').length
    };

    document.getElementById('stats-grid').innerHTML = `
        <div class="stat-card"><h3>${stats.total}</h3><p>Total Delegado</p></div>
        <div class="stat-card" style="color:#ef4444; border-bottom: 4px solid #ef4444;"><h3>${stats.atrasadas}</h3><p>Risco / Atraso</p></div>
        <div class="stat-card" style="color:#3b82f6; border-bottom: 4px solid #3b82f6;"><h3>${stats.pendentes}</h3><p>Requer seu OK</p></div>
        <div class="stat-card" style="color:#10b981; border-bottom: 4px solid #10b981;"><h3>${stats.total > 0 ? Math.round((stats.concluidas/stats.total)*100) : 0}%</h3><p>Saúde Global</p></div>
    `;

    // 2. RENDERIZA OS GRÁFICOS (PIZZA E BARRAS)
    updateCharts(filtered);
    
    // 3. RENDERIZA SAÚDE DOS PROJETOS (Apenas visão geral)
    renderProjectHealth(selected === 'geral' ? visibleTasks : filtered);
    
    // 4. RENDERIZA MATRIZ DE RISCO
    renderRiskMatrix(filtered);
    
    // Se a tabela de tarefas de baixo precisar atualizar
    renderBoard();
}

function updateCharts(tasks) {
    // Matemática do Gráfico de Pizza
    const s = { fazer: 0, andamento: 0, aprovacao: 0, concluido: 0 };
    tasks.forEach(t => s[t.status] = (s[t.status] || 0) + 1);
    
    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart(document.getElementById('mainChart').getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: ['Fazer', 'Andamento', 'Aguard. OK', 'Concluído'],
            datasets: [{ data: [s.fazer, s.andamento, s.aprovacao, s.concluido], backgroundColor: ['#ef4444', '#f59e0b', '#3b82f6', '#10b981'] }]
        },
        options: { plugins: { legend: { position: 'bottom' } } }
    });

    // Matemática do Gráfico de Gargalo (A Fazer / Andamento por Usuário)
    const userGargalo = {};
    tasks.forEach(t => {
        if(t.status === 'fazer' || t.status === 'andamento') {
            const responsaveis = t.resps && t.resps.length > 0 ? t.resps : [{nome: "Sem Dono"}];
            responsaveis.forEach(r => {
                const nomeCurto = r.nome.split(' ')[0]; // Pega só o primeiro nome
                userGargalo[nomeCurto] = (userGargalo[nomeCurto] || 0) + 1;
            });
        }
    });

    const labelsUser = Object.keys(userGargalo);
    const dataUser = Object.values(userGargalo);

    if (userBarChartInstance) userBarChartInstance.destroy();
    userBarChartInstance = new Chart(document.getElementById('userBarChart').getContext('2d'), {
        type: 'bar',
        data: {
            labels: labelsUser,
            datasets: [{ label: 'Tarefas Pendentes', data: dataUser, backgroundColor: '#f59e0b', borderRadius: 4 }]
        },
        options: { scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }
    });
}

function renderProjectHealth(tasks) {
    const board = document.getElementById('projectHealthBoard');
    if(tasks.length === 0) { board.innerHTML = '<p style="color:#64748b;">Sem dados.</p>'; return; }

    const projStats = {};
    tasks.forEach(t => {
        if(!projStats[t.project]) projStats[t.project] = { total: 0, concluidas: 0 };
        projStats[t.project].total++;
        if(t.status === 'concluido') projStats[t.project].concluidas++;
    });

    let html = '';
    for (const [proj, data] of Object.entries(projStats)) {
        const perc = Math.round((data.concluidas / data.total) * 100);
        let color = perc < 40 ? '#ef4444' : (perc < 80 ? '#f59e0b' : '#10b981');
        html += `
            <div style="margin-bottom: 12px;">
                <div style="display:flex; justify-content: space-between; font-size: 0.85rem; font-weight: bold; color: #334155; margin-bottom: 4px;">
                    <span>${proj}</span> <span>${perc}% (${data.concluidas}/${data.total})</span>
                </div>
                <div style="background: #e2e8f0; height: 10px; border-radius: 5px; overflow: hidden;">
                    <div style="background: ${color}; width: ${perc}%; height: 100%; transition: width 0.5s;"></div>
                </div>
            </div>
        `;
    }
    board.innerHTML = html;
}

function renderRiskMatrix(tasks) {
    const board = document.getElementById('riskMatrixBoard');
    const today = new Date();
    today.setHours(0,0,0,0);

    const riscoAlto = tasks.filter(t => {
        if(t.status === 'concluido' || t.status === 'aprovacao' || t.date === "Sem prazo") return false;
        const taskDate = new Date(t.date);
        // Filtra atrasadas ou que vencem em até 2 dias
        const diffTime = taskDate - today;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays <= 2; 
    }).sort((a, b) => new Date(a.date) - new Date(b.date)); // Ordena do mais atrasado para o mais recente

    if(riscoAlto.length === 0) {
        board.innerHTML = '<p style="color:#10b981; font-weight:bold;">Tudo sob controle. Nenhum atraso iminente.</p>';
        return;
    }

    let html = '<ul style="list-style: none; padding: 0; margin: 0;">';
    riscoAlto.forEach(t => {
        const nomeResp = t.resps && t.resps.length > 0 ? t.resps[0].nome.split(' ')[0] : "N/D";
        const taskDate = new Date(t.date);
        const isLate = taskDate < today;
        const label = isLate ? `<span style="color:#ef4444; font-weight:bold;">Atrasado (${t.date})</span>` : `<span style="color:#f59e0b; font-weight:bold;">Vence em breve (${t.date})</span>`;
        
        html += `
            <li style="border-bottom: 1px solid #fecaca; padding: 8px 0; font-size: 0.85rem;" onclick="abrirModal('${t.id}')" style="cursor:pointer;">
                <strong>${t.text}</strong> <br>
                👤 ${nomeResp} | ⏳ ${label}
            </li>
        `;
    });
    html += '</ul>';
    board.innerHTML = html;
}

function renderBoard() {
    const board = document.getElementById('projectsBoard');
    board.innerHTML = '';
    const visibleTasks = getVisibleTasks();
    const selected = document.getElementById('filterProject').value;
    const filtered = selected === 'geral' ? visibleTasks : visibleTasks.filter(t => t.project === selected);

    if(filtered.length === 0) { board.innerHTML = '<p style="text-align:center; padding:20px;">Nenhuma tarefa encontrada para este filtro.</p>'; return; }

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
            
            html += `<div class="task-item" onclick="abrirModal('${t.id}')" style="cursor:pointer; padding:8px; border-bottom:1px solid #f1f5f9; display:flex; justify-content:space-between; align-items:center;">
                <div><strong>${t.text}</strong> <small style="color:#64748b;">(${nomeResp})</small></div>
                <span style="font-size:0.75rem; padding:4px 8px; border-radius:4px; font-weight:bold; ${statusColor}">${t.status.toUpperCase()}</span>
            </div>`;
        });
        html += `</div>`;
        board.innerHTML += html;
    }
}

// 5. MODAL DE GESTÃO
async function abrirModal(id) {
    currentTaskId = id;
    const t = allTasks.find(x => x.id === id);
    document.getElementById('taskModal').style.display = 'block';
    
    const isGestor = (currentUserRole === 'super-admin' || currentUserRole === 'gestor');
    
    document.getElementById('editTitle').value = t.text;
    document.getElementById('editTitle').disabled = !isGestor;
    document.getElementById('editDate').value = t.date !== "Sem prazo" ? t.date : "";
    document.getElementById('editDate').disabled = !isGestor;
    document.getElementById('editDesc').value = t.descricao || "Sem escopo inicial.";
    document.getElementById('editDesc').disabled = !isGestor; 
    document.getElementById('newReport').value = ""; 
    
    const statusSelect = document.getElementById('editStatus');
    statusSelect.value = t.status;
    const optConcluido = document.getElementById('opt-concluido');
    if (optConcluido) optConcluido.style.display = isGestor ? 'block' : 'none';
    
    if (!isGestor && t.status === 'concluido') {
        statusSelect.disabled = true;
        document.getElementById('newReport').disabled = true;
        document.getElementById('newReport').placeholder = "Tarefa concluída. Apenas gestores podem reabrir.";
    } else {
        statusSelect.disabled = false;
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
    
    const update = { status: newStatus };
    if(isGestor) {
        update.text = document.getElementById('editTitle').value;
        update.date = document.getElementById('editDate').value || "Sem prazo";
        update.descricao = document.getElementById('editDesc').value;
    }

    if(newReportText !== "") {
        update.historico = firebase.firestore.FieldValue.arrayUnion({
            data: new Date().toLocaleString('pt-BR'), autor: currentUserEmail, texto: newReportText
        });
    } else if (newStatus !== t.status) { 
        update.historico = firebase.firestore.FieldValue.arrayUnion({
            data: new Date().toLocaleString('pt-BR'), autor: "SISTEMA",
            texto: `Mudou o status para [${newStatus.toUpperCase()}]`
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

// Adm Usuários
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