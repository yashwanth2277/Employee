/* ============================================================
   AI EMPLOYEE MANAGEMENT SYSTEM — app.js
   AI Planning Engine: Task Decomposition, Team Matching,
   Dependency Graph (D3.js), Gantt Timeline, Charts (Chart.js)
   ============================================================ */

/* ===== GLOBAL STATE ===== */
const STATE = {
  projects: [],
  employees: [],
  history: [],
  tools: [],
  plan: null,   // Generated AI plan
  loaded: { projects: false, employees: false, history: false, tools: false },
};

let workloadChartInst = null;
let priorityChartInst = null;
let graphSvg = null;
let graphZoom = null;

/* ===== NAVIGATION ===== */
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', e => {
    e.preventDefault();
    const page = item.dataset.page;
    navigateTo(page);
  });
});

function navigateTo(page) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('nav-' + page).classList.add('active');
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  document.getElementById('pageTitle').textContent = {
    dashboard: 'Dashboard',
    projects: 'Projects',
    team: 'Team',
    graph: 'Dependency Graph',
    timeline: 'Timeline',
    history: 'History',
  }[page] || page;

  if (page === 'graph' && STATE.plan) renderDependencyGraph();
  if (page === 'timeline' && STATE.plan) renderTimeline();
}

function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  const mc = document.querySelector('.main-content');
  sb.classList.toggle('collapsed');
  mc.classList.toggle('expanded');
}

/* ===== TOAST ===== */
function showToast(msg, duration = 3000) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}

/* ============================================================
   UNIFIED CSV UPLOAD — AUTO-DETECT BY COLUMN HEADERS
   ============================================================ */

/**
 * Strip UTF-8 BOM and normalize a header string.
 * Windows-saved CSVs often prepend \uFEFF to the first column name.
 */
function cleanHeader(h) {
  return (h || '').replace(/^\uFEFF/, '').toLowerCase().replace(/[^a-z0-9_]/g, '').trim();
}

/**
 * Detect CSV type from its column headers.
 * Returns: 'projects' | 'employees' | 'history' | 'tools' | 'unknown'
 */
function detectCSVType(rawHeaders) {
  const cols = rawHeaders.map(cleanHeader);
  const has  = (...keys) => keys.every(k => cols.some(c => c.includes(k)));
  const any  = (...keys) => keys.some(k  => cols.some(c => c.includes(k)));

  // ── PROJECTS ────────────────────────────────────────────────
  if (has('projectid') || has('project_id')) {
    if (any('requiredskill', 'required_skill', 'skill') && any('deadline', 'days', 'duration')) return 'projects';
    if (any('description', 'desc') && any('priority', 'prio'))  return 'projects';
    if (any('priority', 'deadline'))                             return 'projects';
  }

  // ── EMPLOYEES ───────────────────────────────────────────────
  if (any('employeeid', 'employee_id', 'empid', 'emp_id') ||
      (any('employeename', 'employee_name', 'name') && any('role', 'designation', 'jobtitle'))) {
    if (any('skill', 'expertise', 'technology'))  return 'employees';
    if (any('experience', 'exp', 'years'))         return 'employees';
    if (any('workload', 'load', 'capacity'))       return 'employees';
    return 'employees';  // id + role is enough
  }

  // ── HISTORY ─────────────────────────────────────────────────
  if (any('completionday', 'completion_day', 'actualday', 'daystocompl') ||
      any('successscore', 'success_score', 'score') ||
      (any('historyid', 'history_id') && any('projectid', 'project_id'))) {
    return 'history';
  }

  // ── TOOLS ───────────────────────────────────────────────────
  if (any('toolid', 'tool_id') ||
      (any('toolname', 'tool_name', 'tooltype', 'tool_type') && cols.length <= 6)) {
    return 'tools';
  }

  // ── LAST-RESORT FUZZY ────────────────────────────────────────
  if (any('priority') && any('deadline', 'days'))  return 'projects';
  if (any('workload') || any('designation'))        return 'employees';
  if (any('success') && any('team'))                return 'history';
  if (any('toolname', 'tooltype'))                  return 'tools';

  return 'unknown';
}

const TYPE_META = {
  projects:  { icon: '📁', label: 'Projects',        badge: 'badge-projects',  required: true },
  employees: { icon: '👥', label: 'Employees',       badge: 'badge-employees', required: true },
  history:   { icon: '📜', label: 'Project History', badge: 'badge-history',   required: false },
  tools:     { icon: '🛠️', label: 'Tools',           badge: 'badge-tools',     required: false },
  unknown:   { icon: '❓', label: 'Unrecognized',    badge: 'badge-unknown',   required: false },
};

/* Handle drag-and-drop */
function handleDrop(event) {
  event.preventDefault();
  document.getElementById('dropZone').classList.remove('drag-over');
  const files = Array.from(event.dataTransfer.files).filter(f => f.name.toLowerCase().endsWith('.csv'));
  if (!files.length) { showToast('⚠️ Please drop CSV files only'); return; }
  processFiles(files);
}

/* Handle file input (browse button) */
function handleFileInput(input) {
  const files = Array.from(input.files);
  if (!files.length) return;
  processFiles(files);
  input.value = ''; // reset so the same file can be re-selected
}

/* Process an array of File objects — parse, detect, store */
function processFiles(files) {
  if (!STATE._parsedFiles) STATE._parsedFiles = [];
  let pending = files.length;

  files.forEach(file => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      encoding: 'UTF-8',
      complete: results => {
        const rawHeaders = results.meta.fields || [];
        const type = detectCSVType(rawHeaders);

        if (type !== 'unknown') {
          STATE[type] = results.data;
          STATE.loaded[type] = true;
        }

        // Remove any previous entry for same type (overwrite) then add new
        STATE._parsedFiles = STATE._parsedFiles.filter(f => f.type !== type || type === 'unknown');
        STATE._parsedFiles.push({
          name: file.name,
          type,
          rows: results.data.length,
          data: results.data,     // keep raw data for manual-assign
          headers: rawHeaders,
        });

        pending--;
        if (pending === 0) {
          renderDetectedList();
          checkReadyToGenerate();
          showToast(`✅ ${files.length} file${files.length > 1 ? 's' : ''} processed`);
        }
      },
      error: () => {
        pending--;
        showToast(`❌ Could not parse ${file.name}`);
      }
    });
  });
}

/**
 * Manually assign a type to an unrecognized file (called from inline select).
 */
function manualAssignType(fileName, newType) {
  if (!newType || newType === 'unknown') return;
  const entry = (STATE._parsedFiles || []).find(f => f.name === fileName);
  if (!entry) return;

  // Remove old entry for the chosen type so we don't have duplicates
  STATE._parsedFiles = STATE._parsedFiles.filter(f => f.name !== fileName && f.type !== newType);

  entry.type = newType;
  STATE[newType] = entry.data;
  STATE.loaded[newType] = true;
  STATE._parsedFiles.push(entry);

  renderDetectedList();
  checkReadyToGenerate();
  showToast(`✅ Assigned "${fileName}" as ${TYPE_META[newType].label}`);
}

/* Render the detected-files list below the drop zone */
function renderDetectedList() {
  const list = document.getElementById('detectedFilesList');
  if (!STATE._parsedFiles || !STATE._parsedFiles.length) { list.style.display = 'none'; return; }

  list.style.display = 'flex';
  list.innerHTML = '';

  STATE._parsedFiles.forEach(f => {
    const meta = TYPE_META[f.type] || TYPE_META.unknown;
    const ok   = f.type !== 'unknown';
    const item = document.createElement('div');
    item.className = `detected-item ${ok ? 'ok' : 'warn'}`;

    // If unrecognized → show a manual assign dropdown
    const manualSel = ok ? '' : `
      <select class="manual-type-sel" onchange="manualAssignType('${f.name}', this.value)">
        <option value="">— Assign type —</option>
        <option value="projects">📁 Projects</option>
        <option value="employees">👥 Employees</option>
        <option value="history">📜 History</option>
        <option value="tools">🛠️ Tools</option>
      </select>`;

    item.innerHTML = `
      <span class="detected-check">${ok ? '✅' : '⚠️'}</span>
      <span class="detected-badge ${meta.badge}">${meta.icon} ${meta.label}</span>
      <span class="detected-filename">${f.name}</span>
      <span class="detected-rows">${f.rows} rows</span>
      ${manualSel}
    `;
    list.appendChild(item);
  });
}

function checkReadyToGenerate() {
  const ready = STATE.loaded.projects && STATE.loaded.employees;
  document.getElementById('btnGenerate').disabled = !ready;
}


/* ===== DEMO DATA ===== */
const DEMO_EMPLOYEES = `employee_id,employee_name,role,skills,experience,current_workload_percent
EMP001,Aarav Sharma,AI Engineer,Python;LLMs;TensorFlow;NLP,4,40
EMP002,Riya Patel,Data Scientist,Python;Data Analysis;ML;Pandas,3,35
EMP003,Vikram Singh,Backend Developer,Node.js;APIs;PostgreSQL;Docker,5,50
EMP004,Sneha Reddy,Frontend Developer,React;UI/UX;JavaScript;CSS,2,30
EMP005,Karthik Rao,DevOps Engineer,Docker;Kubernetes;CI/CD;AWS,4,45
EMP006,Meera Nair,AI Researcher,LLMs;NLP;RAG;PyTorch,6,55
EMP007,Arjun Mehta,Full Stack Developer,React;Node.js;Python;MongoDB,5,60
EMP008,Divya Krishnan,Data Engineer,Spark;SQL;ETL;Python,4,25
EMP009,Rahul Gupta,ML Engineer,Scikit-learn;Python;ML;XGBoost,3,40
EMP010,Priya Joshi,Product Manager,Agile;Scrum;JIRA;Planning,7,50`;

const DEMO_PROJECTS = `project_id,project_name,description,required_skills,deadline_days,priority
PRJ001,AI Sales Assistant,AI assistant for sales teams using LLM and NLP to automate customer interactions,LLM;NLP;API;Python,30,High
PRJ002,Healthcare Predictor,Predict early disease onset using patient data and machine learning models,ML;Data Analysis;Python;SQL,45,High
PRJ003,Customer AI Chatbot,AI chatbot using LLM and RAG for real-time customer support,LLM;RAG;Python;Node.js,25,Medium
PRJ004,Smart Inventory System,Automated inventory management using Python and ML forecasting,Python;ML;PostgreSQL;APIs,40,Medium
PRJ005,HR Analytics Dashboard,Interactive dashboard for HR analytics with employee performance visualization,React;Python;Data Analysis;UI/UX,20,Low
PRJ006,Fraud Detection Engine,Real-time fraud detection using ML and streaming data pipelines,ML;Python;Spark;ETL,35,High`;

const DEMO_HISTORY = `history_id,project_id,project_name,team_size,tools_used,completion_days,success_score
H001,PRJ010,Fraud Detection System,4,Python;Scikit-learn;Spark,28,0.92
H002,PRJ011,AI Resume Screener,3,Python;NLP;LLM,22,0.89
H003,PRJ012,Retail Recommender,5,TensorFlow;Python;MongoDB,35,0.94
H004,PRJ013,Sentiment Analyzer,2,Python;NLTK;BERT,18,0.87
H005,PRJ014,Supply Chain Optimizer,4,Python;OR-Tools;PostgreSQL,30,0.91
H006,PRJ015,Customer Churn Predictor,3,XGBoost;Python;Pandas,24,0.88`;

const DEMO_TOOLS = `tool_id,tool_name,tool_type,purpose
T001,OpenAI API,LLM API,Natural language reasoning and generation
T002,Pinecone,Vector Database,RAG and semantic search
T003,PostgreSQL,Database,Structured relational data storage
T004,Google Search,Search Engine,External information retrieval
T005,LangChain,AI Framework,Agent orchestration and tool integration
T006,TensorFlow,ML Framework,Deep learning model training and inference
T007,Scikit-learn,ML Library,Classical ML model development
T008,Apache Spark,Data Processing,Large-scale data pipeline and ETL
T009,Docker,Containerization,Environment standardization and deployment
T010,React,Frontend Framework,Interactive web UI development`;

function loadDemoData() {
  STATE._parsedFiles = [];
  ['employees', 'projects', 'history', 'tools'].forEach(type => {
    const src = { employees: DEMO_EMPLOYEES, projects: DEMO_PROJECTS, history: DEMO_HISTORY, tools: DEMO_TOOLS }[type];
    const parsed = Papa.parse(src, { header: true, skipEmptyLines: true });
    STATE[type] = parsed.data;
    STATE.loaded[type] = true;
    const meta = TYPE_META[type];
    STATE._parsedFiles.push({ name: `demo_${type}.csv`, type, rows: parsed.data.length });
  });
  renderDetectedList();
  checkReadyToGenerate();
  showToast('⚡ Demo data loaded! Click "Generate AI Plan"');
}

/* ============================================================
   AI PLANNING ENGINE
   ============================================================ */

/* Phase definitions with estimated weight factors */
const PHASES = [
  { id: 'research',    label: 'Research & Analysis',  icon: '🔍', weight: 0.15, color: '#818cf8', cls: 'phase-research' },
  { id: 'design',      label: 'System Design',         icon: '🎨', weight: 0.15, color: '#a78bfa', cls: 'phase-design' },
  { id: 'development', label: 'Development',           icon: '💻', weight: 0.45, color: '#4f9cf9', cls: 'phase-development' },
  { id: 'testing',     label: 'Testing & QA',          icon: '🧪', weight: 0.15, color: '#34d399', cls: 'phase-testing' },
  { id: 'deployment',  label: 'Deployment & Handoff',  icon: '🚀', weight: 0.10, color: '#fb923c', cls: 'phase-deployment' },
];

/* Complexity multiplier based on required skill count and deadline */
function estimateComplexity(project) {
  const skillCount = project.required_skills.split(';').length;
  const deadline = parseInt(project.deadline_days) || 30;
  let score = 1.0;
  if (skillCount >= 4) score += 0.4;
  else if (skillCount >= 3) score += 0.2;
  if (deadline <= 20) score += 0.3;
  else if (deadline >= 45) score -= 0.1;
  if ((project.priority || '').toLowerCase() === 'high') score += 0.2;
  return Math.max(0.8, Math.min(score, 2.0));
}

/* AI Task Breakdown */
function generateTaskBreakdown(project) {
  const deadline = parseInt(project.deadline_days) || 30;
  const complexity = estimateComplexity(project);
  const tasks = [];

  let dayOffset = 0;
  PHASES.forEach((phase, idx) => {
    const phaseDays = Math.max(2, Math.round(deadline * phase.weight * complexity));
    const taskId = `${project.project_id}-T${String(idx + 1).padStart(2, '0')}`;
    const deps = idx === 0 ? [] : [`${project.project_id}-T${String(idx).padStart(2, '0')}`];

    tasks.push({
      id: taskId,
      projectId: project.project_id,
      projectName: project.project_name,
      phase: phase.id,
      phaseLabel: phase.label,
      phaseIcon: phase.icon,
      phaseColor: phase.color,
      phaseCls: phase.cls,
      label: `${phase.label}`,
      estimatedDays: phaseDays,
      startDay: dayOffset,
      endDay: dayOffset + phaseDays,
      dependencies: deps,
      assignees: [],
    });

    dayOffset += phaseDays;
  });

  return tasks;
}

/* Skill matching score: how well does an employee match project skills */
function skillMatchScore(employeeSkills, requiredSkills) {
  const empArr = employeeSkills.toLowerCase().split(';').map(s => s.trim());
  const reqArr = requiredSkills.toLowerCase().split(';').map(s => s.trim());
  let matches = 0;
  reqArr.forEach(req => {
    if (empArr.some(e => e.includes(req) || req.includes(e))) matches++;
  });
  return matches / reqArr.length;
}

/* Assign best team to each project */
function assignTeams(projects, employees) {
  // Track additional workload per employee
  const addedWorkload = {};
  employees.forEach(e => { addedWorkload[e.employee_id] = 0; });

  return projects.map(project => {
    const reqSkills = project.required_skills || '';
    const teamSize = Math.min(
      Math.max(2, project.required_skills.split(';').length - 1),
      Math.min(5, Math.ceil(employees.length / 2))
    );

    // Score each employee
    const scored = employees.map(emp => {
      const currentLoad = parseInt(emp.current_workload_percent) || 0;
      const totalLoad = currentLoad + addedWorkload[emp.employee_id];
      const skillScore = skillMatchScore(emp.skills || '', reqSkills);
      const loadPenalty = totalLoad / 100;
      const expBonus = Math.min(parseInt(emp.experience) || 0, 7) / 7 * 0.2;
      const totalScore = skillScore * 0.65 + (1 - loadPenalty) * 0.25 + expBonus;
      return { ...emp, skillScore, totalScore, totalLoad };
    });

    scored.sort((a, b) => b.totalScore - a.totalScore);
    const team = scored.slice(0, teamSize);

    // Add 10-15% workload per project to assigned members
    team.forEach(member => {
      addedWorkload[member.employee_id] = (addedWorkload[member.employee_id] || 0) + 12;
    });

    return { ...project, assignedTeam: team, teamSize };
  });
}

/* Sort projects by priority */
function sortByPriority(projects) {
  const order = { high: 0, medium: 1, low: 2 };
  return [...projects].sort((a, b) => {
    const pa = order[(a.priority || '').toLowerCase()] ?? 1;
    const pb = order[(b.priority || '').toLowerCase()] ?? 1;
    if (pa !== pb) return pa - pb;
    return parseInt(a.deadline_days) - parseInt(b.deadline_days);
  });
}

/* Main AI Generate */
function generatePlan() {
  if (!STATE.loaded.projects || !STATE.loaded.employees) {
    showToast('⚠️ Please upload Projects and Employees CSVs first');
    return;
  }

  showToast('🤖 AI Engine processing...');

  // Close modal with slight delay to show animation
  setTimeout(() => {
    document.getElementById('uploadModal').classList.remove('open');

    const sortedProjects = sortByPriority(STATE.projects);
    const projectsWithTeams = assignTeams(sortedProjects, STATE.employees);

    const fullPlan = projectsWithTeams.map(project => {
      const tasks = generateTaskBreakdown(project);
      // Assign task-level members
      tasks.forEach(task => {
        task.assignees = project.assignedTeam.slice(0, Math.ceil(project.assignedTeam.length / 2));
        if (task.phase === 'development') task.assignees = project.assignedTeam;
      });
      return { ...project, tasks };
    });

    STATE.plan = fullPlan;

    updateStats();
    renderDashboardGrid();
    renderProjectsPage();
    renderTeamPage();
    renderDependencyGraph();
    renderTimeline();
    if (STATE.history.length > 0) renderHistoryPage();
    renderCharts();
    populateFilters();

    document.getElementById('statusBadge').textContent = 'Plan Ready';
    document.getElementById('statusBadge').classList.add('ready');
    showToast('✅ AI Plan generated successfully!', 4000);
  }, 400);
}

/* ===== STATS ===== */
function updateStats() {
  const totalTasks = STATE.plan.reduce((sum, p) => sum + p.tasks.length, 0);
  const avgDays = STATE.plan.length
    ? Math.round(STATE.plan.reduce((sum, p) => sum + (parseInt(p.deadline_days) || 30), 0) / STATE.plan.length)
    : 0;

  document.getElementById('statProjects').textContent = STATE.plan.length;
  document.getElementById('statEmployees').textContent = STATE.employees.length;
  document.getElementById('statTasks').textContent = totalTasks;
  document.getElementById('statDays').textContent = avgDays;
}

/* ============================================================
   RENDER — DASHBOARD GRID
   ============================================================ */
function renderDashboardGrid() {
  const container = document.getElementById('dashboardProjectGrid');
  container.innerHTML = '';

  STATE.plan.forEach(project => {
    const prio = (project.priority || 'medium').toLowerCase();
    const deadline = parseInt(project.deadline_days) || 30;
    const skills = (project.required_skills || '').split(';');
    const maxDeadline = 60;
    const fillPct = Math.min(100, Math.round((deadline / maxDeadline) * 100));

    const card = document.createElement('div');
    card.className = `project-card ${prio}`;
    card.onclick = () => navigateTo('projects');

    card.innerHTML = `
      <div class="project-card-header">
        <span class="project-id">${project.project_id}</span>
        <span class="priority-badge ${prio}">${project.priority || 'Medium'}</span>
      </div>
      <div class="project-name">${project.project_name}</div>
      <div class="project-desc">${(project.description || '').substring(0, 120)}...</div>
      <div class="project-meta">
        <div class="meta-item">⏱️ <strong>${deadline}</strong> days</div>
        <div class="meta-item">👥 <strong>${project.assignedTeam.length}</strong> members</div>
        <div class="meta-item">📋 <strong>${project.tasks.length}</strong> tasks</div>
      </div>
      <div class="skill-tags">
        ${skills.slice(0, 4).map(s => `<span class="skill-tag">${s.trim()}</span>`).join('')}
        ${skills.length > 4 ? `<span class="skill-tag">+${skills.length - 4}</span>` : ''}
      </div>
      <div class="assigned-team">
        <div class="team-label">👤 Assigned Team</div>
        <div class="team-avatars">
          ${project.assignedTeam.slice(0, 4).map(m =>
            `<span class="avatar-chip">👤 ${m.employee_name.split(' ')[0]}</span>`
          ).join('')}
          ${project.assignedTeam.length > 4 ? `<span class="avatar-chip">+${project.assignedTeam.length - 4}</span>` : ''}
        </div>
      </div>
      <div class="est-time-bar">
        <div class="est-time-label"><span>Timeline Progress</span><span>${deadline} days</span></div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" style="width: ${fillPct}%"></div>
        </div>
      </div>
    `;

    container.appendChild(card);
  });
}

/* ============================================================
   RENDER — PROJECTS PAGE (Full Task Breakdown)
   ============================================================ */
function renderProjectsPage() {
  const container = document.getElementById('projectsContainer');
  container.innerHTML = '';

  STATE.plan.forEach(project => {
    const prio = (project.priority || 'medium').toLowerCase();
    const prioColors = { high: '#f87171', medium: '#fb923c', low: '#34d399' };
    const color = prioColors[prio] || '#4f9cf9';
    const totalEst = project.tasks.reduce((s, t) => s + t.estimatedDays, 0);

    const div = document.createElement('div');
    div.className = 'project-plan';

    const teamHtml = project.assignedTeam.map(m =>
      `<span class="avatar-chip">👤 ${m.employee_name}</span>`
    ).join('');

    const tasksHtml = project.tasks.map(task => `
      <tr>
        <td><span class="phase-badge ${task.phaseCls}">${task.phaseIcon} ${task.phaseLabel}</span></td>
        <td style="font-family:'Fira Code',monospace;font-size:12px;color:#94a3b8">${task.id}</td>
        <td><strong>${task.estimatedDays}</strong> days</td>
        <td>Day ${task.startDay + 1} → Day ${task.endDay}</td>
        <td class="dep-chain">${task.dependencies.length ? task.dependencies.join(', ') : '— (Start)'}</td>
        <td>
          ${task.assignees.slice(0, 2).map(a => `<span class="avatar-chip" style="font-size:10px">👤 ${a.employee_name.split(' ')[0]}</span>`).join('')}
          ${task.assignees.length > 2 ? `<span style="font-size:11px;color:#94a3b8">+${task.assignees.length - 2}</span>` : ''}
        </td>
      </tr>
    `).join('');

    div.innerHTML = `
      <div class="plan-header" onclick="togglePlanBody(this)">
        <div class="plan-title">
          <span style="color:${color}">●</span>
          ${project.project_name}
          <span class="priority-badge ${prio}">${project.priority}</span>
          <span style="font-size:11px;color:#64748b;font-family:'Fira Code',monospace">${project.project_id}</span>
        </div>
        <div class="plan-meta">
          <span style="font-size:13px;color:#94a3b8">⏱️ ${parseInt(project.deadline_days)} days deadline | 📋 ${project.tasks.length} tasks | 👥 Team of ${project.assignedTeam.length}</span>
          <span style="font-size:18px;color:#64748b;transform:rotate(0deg);transition:0.3s" class="chevron">▼</span>
        </div>
      </div>
      <div class="plan-body open">
        <div style="margin-bottom:16px;font-size:13px;color:#94a3b8;line-height:1.7">${project.description}</div>
        <div style="margin-bottom:16px;display:flex;gap:14px;flex-wrap:wrap">
          <div style="font-size:12px"><span style="color:#64748b">Required Skills: </span>
            ${(project.required_skills || '').split(';').map(s => `<span class="skill-tag">${s.trim()}</span>`).join('')}
          </div>
        </div>
        <div style="margin-bottom:16px">
          <div class="team-label">👥 Assigned Team</div>
          <div class="team-avatars" style="margin-top:6px">${teamHtml}</div>
        </div>
        <table class="tasks-table">
          <thead>
            <tr>
              <th>Phase</th>
              <th>Task ID</th>
              <th>Est. Duration</th>
              <th>Timeline</th>
              <th>Dependencies</th>
              <th>Assignees</th>
            </tr>
          </thead>
          <tbody>${tasksHtml}</tbody>
        </table>
        <div style="font-size:13px;color:#64748b">
          📊 Total estimated: <strong style="color:#4f9cf9">${totalEst} working days</strong> 
          (Deadline: ${parseInt(project.deadline_days)} days — 
          <span style="color:${totalEst <= parseInt(project.deadline_days) ? '#34d399' : '#f87171'}">
            ${totalEst <= parseInt(project.deadline_days) ? '✅ Within deadline' : '⚠️ May exceed deadline'}
          </span>)
        </div>
      </div>
    `;

    container.appendChild(div);
  });
}

function togglePlanBody(headerEl) {
  const body = headerEl.nextElementSibling;
  body.classList.toggle('open');
  const chevron = headerEl.querySelector('.chevron');
  if (chevron) chevron.style.transform = body.classList.contains('open') ? 'rotate(0deg)' : 'rotate(-90deg)';
}

/* ============================================================
   RENDER — TEAM PAGE
   ============================================================ */
function renderTeamPage() {
  const container = document.getElementById('teamGrid');
  container.innerHTML = '';

  const AVATAR_COLORS = [
    'linear-gradient(135deg,#4f9cf9,#818cf8)',
    'linear-gradient(135deg,#a78bfa,#ec4899)',
    'linear-gradient(135deg,#34d399,#4f9cf9)',
    'linear-gradient(135deg,#fb923c,#f87171)',
    'linear-gradient(135deg,#818cf8,#34d399)',
    'linear-gradient(135deg,#fbbf24,#fb923c)',
    'linear-gradient(135deg,#ec4899,#a78bfa)',
    'linear-gradient(135deg,#6ee7b7,#4f9cf9)',
  ];

  STATE.employees.forEach((emp, idx) => {
    const load = parseInt(emp.current_workload_percent) || 0;
    const loadCls = load < 40 ? 'wl-low' : load < 70 ? 'wl-mid' : 'wl-high';
    const skills = (emp.skills || '').split(';');
    const initials = (emp.employee_name || 'E').split(' ').map(w => w[0]).join('').toUpperCase();
    const color = AVATAR_COLORS[idx % AVATAR_COLORS.length];

    // Find assigned projects
    const assignedProjects = (STATE.plan || []).filter(p =>
      p.assignedTeam.some(m => m.employee_id === emp.employee_id)
    );

    const card = document.createElement('div');
    card.className = 'team-card';
    card.innerHTML = `
      <div class="team-card-top">
        <div class="avatar-circle" style="background:${color};color:white">${initials}</div>
        <div>
          <div class="emp-name">${emp.employee_name}</div>
          <div class="emp-role">${emp.role}</div>
          <div class="emp-id">${emp.employee_id}</div>
        </div>
      </div>
      <div class="workload-section">
        <div class="workload-header">
          <span>Current Workload</span>
          <span style="font-weight:700;color:${load < 40 ? 'var(--accent3)' : load < 70 ? 'var(--accent4)' : 'var(--danger)'}">${load}%</span>
        </div>
        <div class="workload-bar">
          <div class="workload-fill ${loadCls}" style="width:${load}%"></div>
        </div>
      </div>
      <div class="emp-skills">
        ${skills.map(s => `<span class="emp-skill-tag">${s.trim()}</span>`).join('')}
      </div>
      <div style="font-size:12px;color:#64748b">Experience: <strong style="color:#e2e8f0">${emp.experience} yrs</strong></div>
      ${assignedProjects.length ? `
        <div class="assigned-projects" style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.05)">
          <span>Assigned: </span>
          <strong>${assignedProjects.map(p => p.project_name).join(', ')}</strong>
        </div>
      ` : ''}
    `;

    container.appendChild(card);
  });
}

/* ============================================================
   RENDER — DEPENDENCY GRAPH (D3.js Force-Directed)
   ============================================================ */
function renderDependencyGraph() {
  if (!STATE.plan) return;

  const container = document.getElementById('dependencyGraph');
  container.innerHTML = '';

  const filterVal = document.getElementById('graphProjectFilter').value;

  // Build nodes and links
  const allNodes = [];
  const allLinks = [];
  const nodeMap = {};

  STATE.plan.forEach(project => {
    if (filterVal !== 'all' && project.project_id !== filterVal) return;

    project.tasks.forEach(task => {
      const node = {
        id: task.id,
        label: task.phaseLabel,
        icon: task.phaseIcon,
        phase: task.phase,
        color: task.phaseColor,
        phaseCls: task.phaseCls,
        projectId: project.project_id,
        projectName: project.project_name,
        estimatedDays: task.estimatedDays,
        assignees: task.assignees.map(a => a.employee_name).join(', '),
        priority: project.priority || 'Medium',
      };
      allNodes.push(node);
      nodeMap[task.id] = node;
    });

    project.tasks.forEach(task => {
      task.dependencies.forEach(dep => {
        if (nodeMap[dep]) {
          allLinks.push({ source: dep, target: task.id });
        }
      });
    });
  });

  if (allNodes.length === 0) {
    container.innerHTML = '<div class="empty-state">No data available</div>';
    return;
  }

  // D3 Setup
  const width = container.offsetWidth;
  const height = container.offsetHeight;

  const tooltip = document.createElement('div');
  tooltip.className = 'graph-tooltip';
  container.appendChild(tooltip);

  const svg = d3.select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height);

  graphSvg = svg;

  // Zoom
  graphZoom = d3.zoom()
    .scaleExtent([0.3, 3])
    .on('zoom', e => gContainer.attr('transform', e.transform));

  svg.call(graphZoom);

  const gContainer = svg.append('g');

  // Arrow marker
  svg.append('defs').append('marker')
    .attr('id', 'arrowhead')
    .attr('viewBox', '0 -5 10 10')
    .attr('refX', 20)
    .attr('refY', 0)
    .attr('markerWidth', 8)
    .attr('markerHeight', 8)
    .attr('orient', 'auto')
    .append('path')
    .attr('d', 'M0,-5L10,0L0,5')
    .attr('fill', 'rgba(99,179,237,0.5)');

  // Force simulation
  const simulation = d3.forceSimulation(allNodes)
    .force('link', d3.forceLink(allLinks).id(d => d.id).distance(filterVal === 'all' ? 110 : 140))
    .force('charge', d3.forceManyBody().strength(filterVal === 'all' ? -300 : -400))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide(50));

  // Links
  const link = gContainer.append('g')
    .selectAll('line')
    .data(allLinks)
    .enter().append('line')
    .attr('stroke', 'rgba(99,179,237,0.3)')
    .attr('stroke-width', 1.5)
    .attr('stroke-dasharray', '6,4')
    .attr('marker-end', 'url(#arrowhead)');

  // Node groups
  const node = gContainer.append('g')
    .selectAll('g')
    .data(allNodes)
    .enter().append('g')
    .attr('cursor', 'pointer')
    .call(d3.drag()
      .on('start', (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x; d.fy = d.y;
      })
      .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
      .on('end', (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null; d.fy = null;
      })
    );

  // Glow filter
  const defs = svg.select('defs');
  const filter = defs.append('filter').attr('id', 'glow');
  filter.append('feGaussianBlur').attr('stdDeviation', '3').attr('result', 'coloredBlur');
  const feMerge = filter.append('feMerge');
  feMerge.append('feMergeNode').attr('in', 'coloredBlur');
  feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

  // Circles
  node.append('circle')
    .attr('r', 28)
    .attr('fill', d => d.color + '22')
    .attr('stroke', d => d.color)
    .attr('stroke-width', 2)
    .style('filter', 'url(#glow)')
    .on('mouseover', function (event, d) {
      d3.select(this).attr('r', 34).attr('fill', d.color + '44');
      tooltip.style.opacity = '1';
      tooltip.innerHTML = `
        <strong style="color:${d.color}">${d.icon} ${d.label}</strong><br/>
        <span style="color:#94a3b8;font-size:11px">${d.projectName}</span><br/>
        <span style="font-size:11px">⏱️ ${d.estimatedDays} days</span><br/>
        ${d.assignees ? `<span style="font-size:11px">👤 ${d.assignees}</span>` : ''}
      `;
    })
    .on('mousemove', function (event) {
      const rect = container.getBoundingClientRect();
      tooltip.style.left = (event.clientX - rect.left + 14) + 'px';
      tooltip.style.top = (event.clientY - rect.top - 40) + 'px';
    })
    .on('mouseout', function (event, d) {
      d3.select(this).attr('r', 28).attr('fill', d.color + '22');
      tooltip.style.opacity = '0';
    });

  // Icons
  node.append('text')
    .attr('text-anchor', 'middle')
    .attr('dy', '-4px')
    .attr('font-size', '16px')
    .text(d => d.icon);

  // Day label
  node.append('text')
    .attr('text-anchor', 'middle')
    .attr('dy', '14px')
    .attr('font-size', '10px')
    .attr('fill', 'rgba(226,232,240,0.7)')
    .text(d => `${d.estimatedDays}d`);

  // Phase label below circle
  node.append('text')
    .attr('text-anchor', 'middle')
    .attr('dy', '48px')
    .attr('font-size', '10px')
    .attr('fill', d => d.color)
    .attr('font-weight', '600')
    .text(d => {
      const words = d.label.split(' ');
      return words[0];
    });

  // Simulation tick
  simulation.on('tick', () => {
    link
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y);

    node.attr('transform', d => `translate(${d.x},${d.y})`);
  });
}

function resetZoom() {
  if (graphSvg && graphZoom) {
    graphSvg.transition().duration(600).call(
      graphZoom.transform,
      d3.zoomIdentity
    );
  }
}

/* ============================================================
   RENDER — GANTT TIMELINE
   ============================================================ */
function renderTimeline() {
  if (!STATE.plan) return;

  const container = document.getElementById('timelineContainer');
  container.innerHTML = '';

  const filterVal = document.getElementById('timelineProjectFilter').value;
  const projects = filterVal === 'all' ? STATE.plan : STATE.plan.filter(p => p.project_id === filterVal);

  if (projects.length === 0) {
    container.innerHTML = '<div class="empty-state">No projects to display</div>';
    return;
  }

  const gantt = document.createElement('div');
  gantt.className = 'gantt-container';

  projects.forEach((project, pi) => {
    const maxDays = project.tasks[project.tasks.length - 1].endDay;

    const projDiv = document.createElement('div');
    projDiv.className = 'gantt-project';

    const prio = (project.priority || 'medium').toLowerCase();
    const prioColors = { high: '#f87171', medium: '#fb923c', low: '#34d399' };

    projDiv.innerHTML = `
      <div class="gantt-project-title">
        <span style="color:${prioColors[prio]}">●</span>
        ${project.project_name}
        <span class="priority-badge ${prio}">${project.priority}</span>
        <span style="font-size:12px;color:#64748b">Deadline: ${parseInt(project.deadline_days)} days</span>
      </div>
      <div class="gantt-header">
        <div class="gantt-task-label">Phase</div>
        <div class="gantt-bar-area" style="position:relative;font-size:10px;color:#475569">
          ${Array.from({length: 5}, (_, i) => {
            const day = Math.round((i / 4) * maxDays);
            return `<span style="position:absolute;left:${(i/4)*100}%;transform:translateX(-50%)">Day ${day || 1}</span>`;
          }).join('')}
        </div>
      </div>
    `;

    project.tasks.forEach(task => {
      const barLeft = (task.startDay / maxDays) * 100;
      const barWidth = Math.max(2, (task.estimatedDays / maxDays) * 100);

      const row = document.createElement('div');
      row.className = 'gantt-row';
      row.innerHTML = `
        <div class="gantt-row-label">
          <span>${task.phaseIcon}</span>
          <span>${task.phaseLabel.split(' ')[0]}</span>
        </div>
        <div class="gantt-bar-track">
          <div class="gantt-bar ${task.phaseCls}"
            style="left:${barLeft}%;width:${barWidth}%"
            title="${task.phaseLabel}: ${task.estimatedDays} days (Day ${task.startDay+1}→Day ${task.endDay})">
            ${barWidth > 12 ? `${task.estimatedDays}d` : ''}
          </div>
        </div>
      `;
      projDiv.appendChild(row);
    });

    if (pi < projects.length - 1) {
      const sep = document.createElement('hr');
      sep.className = 'gantt-separator';
      projDiv.appendChild(sep);
    }

    gantt.appendChild(projDiv);
  });

  container.appendChild(gantt);
}

/* ============================================================
   RENDER — HISTORY PAGE
   ============================================================ */
function renderHistoryPage() {
  const container = document.getElementById('historyContainer');
  container.innerHTML = '';

  if (!STATE.history || STATE.history.length === 0) {
    container.innerHTML = '<div class="empty-state">No history data</div>';
    return;
  }

  const totalProjects = STATE.history.length;
  const avgDays = (STATE.history.reduce((s, h) => s + (parseInt(h.completion_days) || 0), 0) / totalProjects).toFixed(1);
  const avgScore = (STATE.history.reduce((s, h) => s + (parseFloat(h.success_score) || 0), 0) / totalProjects).toFixed(2);
  const avgTeam = (STATE.history.reduce((s, h) => s + (parseInt(h.team_size) || 0), 0) / totalProjects).toFixed(1);

  container.innerHTML = `
    <div class="insights-row" style="margin-bottom:24px">
      <div class="insights-panel">
        <div class="insights-title">📊 Historical Insights</div>
        <div class="kv-row"><span class="kv-key">Total Past Projects</span><span class="kv-val">${totalProjects}</span></div>
        <div class="kv-row"><span class="kv-key">Avg. Completion Time</span><span class="kv-val">${avgDays} days</span></div>
        <div class="kv-row"><span class="kv-key">Avg. Success Score</span><span class="kv-val">${(avgScore * 100).toFixed(0)}%</span></div>
        <div class="kv-row"><span class="kv-key">Avg. Team Size</span><span class="kv-val">${avgTeam} members</span></div>
      </div>
      <div class="insights-panel" style="flex:2">
        <div class="insights-title">🏆 Top Performing Projects</div>
        ${STATE.history.sort((a, b) => parseFloat(b.success_score) - parseFloat(a.success_score))
          .slice(0, 3).map(h => `
          <div class="kv-row">
            <span class="kv-key">${h.project_name}</span>
            <span class="kv-val">${Math.round(parseFloat(h.success_score || 0) * 100)}% success</span>
          </div>`).join('')}
      </div>
    </div>
    <div class="history-grid" id="historyGrid"></div>
  `;

  const grid = document.getElementById('historyGrid');
  STATE.history.forEach(h => {
    const score = parseFloat(h.success_score) || 0;
    const scoreCls = score >= 0.9 ? 'score-high' : 'score-mid';
    const card = document.createElement('div');
    card.className = 'history-card';
    card.innerHTML = `
      <div class="history-card-top">
        <span class="history-id">${h.history_id} · ${h.project_id}</span>
        <span class="score-badge ${scoreCls}">⭐ ${Math.round(score * 100)}%</span>
      </div>
      <div class="history-name">${h.project_name}</div>
      <div style="display:flex;gap:14px;font-size:12px;color:#94a3b8;margin-bottom:10px;flex-wrap:wrap">
        <span>👥 Team of ${h.team_size}</span>
        <span>⏱️ ${h.completion_days} days</span>
      </div>
      <div class="skill-tags">
        ${(h.tools_used || '').split(';').map(t => `<span class="skill-tag">${t.trim()}</span>`).join('')}
      </div>
    `;
    grid.appendChild(card);
  });
}

/* ============================================================
   RENDER — CHARTS
   ============================================================ */
function renderCharts() {
  // Workload chart
  const empNames = STATE.employees.map(e => e.employee_name.split(' ')[0]);
  const workloads = STATE.employees.map(e => parseInt(e.current_workload_percent) || 0);
  const wlColors = workloads.map(w => w < 40 ? '#34d399' : w < 70 ? '#fb923c' : '#f87171');

  if (workloadChartInst) workloadChartInst.destroy();

  const wlCtx = document.getElementById('workloadChart').getContext('2d');
  workloadChartInst = new Chart(wlCtx, {
    type: 'bar',
    data: {
      labels: empNames,
      datasets: [{
        label: 'Workload %',
        data: workloads,
        backgroundColor: wlColors,
        borderRadius: 6,
        borderSkipped: false,
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => `${c.raw}% workload` } }
      },
      scales: {
        x: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
        y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.04)' }, max: 100 }
      }
    }
  });

  // Priority doughnut
  const prioCounts = { High: 0, Medium: 0, Low: 0 };
  STATE.plan.forEach(p => {
    const k = (p.priority || 'Medium');
    const normalized = k.charAt(0).toUpperCase() + k.slice(1).toLowerCase();
    if (prioCounts[normalized] !== undefined) prioCounts[normalized]++;
    else prioCounts['Medium']++;
  });

  if (priorityChartInst) priorityChartInst.destroy();

  const prCtx = document.getElementById('priorityChart').getContext('2d');
  priorityChartInst = new Chart(prCtx, {
    type: 'doughnut',
    data: {
      labels: Object.keys(prioCounts),
      datasets: [{
        data: Object.values(prioCounts),
        backgroundColor: ['#f87171', '#fb923c', '#34d399'],
        borderColor: '#111d35',
        borderWidth: 3,
        hoverOffset: 8,
      }]
    },
    options: {
      responsive: true,
      cutout: '65%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#94a3b8', font: { size: 12 }, padding: 14 }
        }
      }
    }
  });
}

/* ===== POPULATE FILTER SELECTS ===== */
function populateFilters() {
  if (!STATE.plan) return;

  ['graphProjectFilter', 'timelineProjectFilter'].forEach(id => {
    const sel = document.getElementById(id);
    // Keep "All Projects" option, remove old project options
    while (sel.options.length > 1) sel.remove(1);
    STATE.plan.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.project_id;
      opt.textContent = `${p.project_id} — ${p.project_name}`;
      sel.appendChild(opt);
    });
  });
}
