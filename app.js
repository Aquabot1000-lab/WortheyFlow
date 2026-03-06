/* WortheyFlow V2.1 — App.js */
(function () {
    'use strict';

    // ========== AUTH ==========
    let currentUser = null; // { id, name, email, role, salesperson }

    function getToken() { return localStorage.getItem('wf_token'); }
    function setToken(t) { localStorage.setItem('wf_token', t); }
    function clearToken() { localStorage.removeItem('wf_token'); localStorage.removeItem('wf_user'); }
    function getStoredUser() { try { return JSON.parse(localStorage.getItem('wf_user')); } catch(e) { return null; } }
    function setStoredUser(u) { localStorage.setItem('wf_user', JSON.stringify(u)); }

    function authHeaders() {
        const t = getToken();
        return t ? { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
    }

    function isAdmin() { return currentUser && currentUser.role === 'admin'; }
    function isSales() { return currentUser && currentUser.role === 'sales'; }
    function isService() { return currentUser && currentUser.role === 'service'; }

    function canSeeLead(lead) {
        if (isAdmin()) return true;
        if (isSales()) return lead.salesperson === currentUser.salesperson;
        if (isService()) {
            return lead.salesperson === currentUser.salesperson &&
                (lead.jobType === 'Equipment Repair' || lead.jobType === 'Service Route');
        }
        return false;
    }

    function myLeads() { return leads.filter(l => canSeeLead(l)); }

    function showLoginScreen() {
        document.getElementById('login-screen').classList.remove('hidden');
        document.getElementById('sidebar').style.display = 'none';
        document.getElementById('main-content').style.display = 'none';
    }

    function hideLoginScreen() {
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('sidebar').style.display = '';
        document.getElementById('main-content').style.display = '';
    }

    function handleLogin(e) {
        e.preventDefault();
        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;
        const errEl = document.getElementById('login-error');
        errEl.classList.add('hidden');
        const url = getApiUrl();
        fetch(url + '/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        }).then(r => r.json()).then(d => {
            if (d.error) { errEl.textContent = d.error; errEl.classList.remove('hidden'); return; }
            setToken(d.token);
            setStoredUser(d.user);
            currentUser = d.user;
            bootApp();
        }).catch(err => { errEl.textContent = 'Cannot reach server.'; errEl.classList.remove('hidden'); });
    }

    function logout() {
        clearToken();
        currentUser = null;
        showLoginScreen();
    }

    function checkAuth() {
        const token = getToken();
        const user = getStoredUser();
        if (!token || !user) { showLoginScreen(); return false; }
        // Verify token is not expired by decoding (simple check)
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            if (payload.exp * 1000 < Date.now()) { clearToken(); showLoginScreen(); return false; }
            currentUser = user;
            return true;
        } catch(e) { clearToken(); showLoginScreen(); return false; }
    }

    function updateTopbarUser() {
        const el = document.getElementById('topbar-user');
        if (currentUser) {
            el.innerHTML = '👤 ' + esc(currentUser.name) + ' <span class="user-role">' + esc(currentUser.role) + '</span>';
        }
    }

    function applyNavPermissions() {
        const links = document.querySelectorAll('.nav-links a');
        links.forEach(a => {
            const page = a.dataset.page;
            a.parentElement.style.display = '';
            if (!isAdmin()) {
                if (page === 'weeklyreview' || page === 'salesman') a.parentElement.style.display = 'none';
                if (page === 'serviceroutes' && !isService()) a.parentElement.style.display = 'none';
            }
        });
    }

    function bootApp() {
        hideLoginScreen();
        updateTopbarUser();
        applyNavPermissions();
        loadData();
        renderCurrentPage();
        startNotificationEngine();
        startDurationChecks();
    }

    // ========== CONSTANTS ==========
    const STAGES = ['New', 'Contacted', 'Consultation Scheduled', 'Consultation Complete', 'Proposal Sent', 'Negotiating', 'Signed', 'Lost'];
    const JOB_TYPES = ['New Pool', 'Remodel', 'Equipment Repair', 'Service Route', 'Commercial'];
    const SOURCES = ['Google Ads', 'Facebook', 'Referral', 'Website', 'Yelp', 'Home Advisor', 'Nextdoor', 'Walk-in', 'Repeat Customer'];
    const LOSS_REASONS = ['Price', 'Went with Competitor', 'Timing', 'No Financing', 'Scope Mismatch', 'No Response', 'Other'];
    const SALESPEOPLE = ['Ricardo', 'Anibal', 'Richard'];
    const POOL_SALESPEOPLE = ['Ricardo', 'Anibal'];
    const SERVICE_SALESPEOPLE = ['Richard'];
    const CONSTRUCTION_TYPES = ['New Pool', 'Remodel', 'Commercial'];
    const SERVICE_TYPES = ['Equipment Repair', 'Service Route'];

    const DEFAULT_PROBS = {
        construction: { 'New': 10, 'Contacted': 20, 'Consultation Scheduled': 35, 'Consultation Complete': 50, 'Proposal Sent': 65, 'Negotiating': 80, 'Signed': 100, 'Lost': 0 },
        service: { 'New': 25, 'Contacted': 50, 'Consultation Scheduled': 65, 'Consultation Complete': 0, 'Proposal Sent': 75, 'Negotiating': 85, 'Signed': 100, 'Lost': 0 }
    };

    const SA_CENTER = [29.4241, -98.4936];

    // ========== NOTIFICATION API ==========
    function getApiUrl() {
        const s = JSON.parse(localStorage.getItem('wf_notif_settings') || '{}');
        return s.apiUrl || (window.location.origin.includes('localhost') ? 'http://localhost:3001' : window.location.origin);
    }
    function getContactDirectory() {
        const s = JSON.parse(localStorage.getItem('wf_notif_settings') || '{}');
        return s.contactDirectory || [
            { name: 'Ricardo', email: '', phone: '' },
            { name: 'Anibal', email: '', phone: '' },
            { name: 'Richard', email: '', phone: '' }
        ];
    }
    function fireAutomationTrigger(event, lead) {
        const url = getApiUrl();
        fetch(url + '/api/automations/trigger', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ event, lead, contactDirectory: getContactDirectory() })
        }).then(r => r.json()).then(d => {
            if (d.triggered > 0) console.log('[WF] Automations triggered:', d.triggered, d.results);
        }).catch(e => console.warn('[WF] Automation trigger failed:', e.message));
    }
    function startDurationChecks() {
        setInterval(() => {
            const url = getApiUrl();
            fetch(url + '/api/automations/check-durations', {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({ leads, contactDirectory: getContactDirectory() })
            }).then(r => r.json()).then(d => {
                if (d.triggered > 0) console.log('[WF] Duration checks fired:', d.triggered, d.results);
            }).catch(() => {});
        }, 300000); // every 5 min
    }

    // ========== STATE ==========
    let leads = [];
    let probabilities = {};
    let monthlyTarget = 200000;
    let serviceRouteData = {};
    let notifications = [];
    let currentLeadId = null;
    let lossCallback = null;
    let dupCallback = null;
    let charts = {};
    let leafletMap = null;
    let leafletMarkers = [];
    let currentFilter = 'all';
    let reviewStart = null;
    let reviewEnd = null;

    // ========== INIT ==========
    function init() {
        // Setup login form
        document.getElementById('login-form').addEventListener('submit', handleLogin);
        setupNav();
        setupBell();
        setupSidebarToggle();
        setupLossModal();
        setupDupModal();
        if (!checkAuth()) return; // show login screen
        bootApp();
    }

    // ========== LOCAL STORAGE ==========
    function loadData() {
        leads = JSON.parse(localStorage.getItem('wf_leads') || 'null') || getDefaultLeads();
        probabilities = JSON.parse(localStorage.getItem('wf_probs') || 'null') || JSON.parse(JSON.stringify(DEFAULT_PROBS));
        monthlyTarget = JSON.parse(localStorage.getItem('wf_target') || '200000');
        serviceRouteData = JSON.parse(localStorage.getItem('wf_routes') || 'null') || getDefaultRoutes();
        notifications = JSON.parse(localStorage.getItem('wf_notifs') || '[]');
    }

    function saveLeads() { localStorage.setItem('wf_leads', JSON.stringify(leads)); }
    function saveProbs() { localStorage.setItem('wf_probs', JSON.stringify(probabilities)); }
    function saveTarget() { localStorage.setItem('wf_target', JSON.stringify(monthlyTarget)); }
    function saveRoutes() { localStorage.setItem('wf_routes', JSON.stringify(serviceRouteData)); }
    function saveNotifs() { localStorage.setItem('wf_notifs', JSON.stringify(notifications)); }

    // ========== SAMPLE DATA ==========
    function getDefaultLeads() {
        const now = Date.now();
        const day = 86400000;
        const hr = 3600000;
        return [
            {
                id: 'L1001', name: 'Carlos Martinez', email: 'carlos@email.com', phone: '210-555-0101',
                company: 'Martinez Residence', address: '1234 Alamo Heights Blvd', city: 'San Antonio', zip: '78209',
                lat: 29.4841, lng: -98.4636, jobType: 'New Pool', source: 'Google Ads',
                stage: 'Negotiating', salesperson: 'Ricardo', quoteAmount: 85000,
                notes: 'Wants infinity edge pool with spa', nextAction: 'Send revised proposal',
                nextActionDate: new Date(now + day).toISOString().slice(0, 10),
                createdAt: now - 12 * day, stageChangedAt: now - 5 * day, firstContactAt: now - 12 * day + 180000,
                lossReason: null, equipmentAge: null
            },
            {
                id: 'L1002', name: 'Jennifer Nguyen', email: 'jnguyen@outlook.com', phone: '210-555-0202',
                company: 'Nguyen Family', address: '5678 Stone Oak Pkwy', city: 'San Antonio', zip: '78258',
                lat: 29.6241, lng: -98.4836, jobType: 'Remodel', source: 'Facebook',
                stage: 'Proposal Sent', salesperson: 'Anibal', quoteAmount: 42000,
                notes: 'Complete pool resurface + new tile', nextAction: 'Follow up on proposal',
                nextActionDate: new Date(now + 2 * day).toISOString().slice(0, 10),
                createdAt: now - 8 * day, stageChangedAt: now - 3 * day, firstContactAt: now - 8 * day + 240000,
                lossReason: null, equipmentAge: null
            },
            {
                id: 'L1003', name: 'Robert Thompson', email: 'rthompson@gmail.com', phone: '210-555-0303',
                company: 'Thompson Estate', address: '9012 Dominion Dr', city: 'San Antonio', zip: '78257',
                lat: 29.6041, lng: -98.5636, jobType: 'Commercial', source: 'Referral',
                stage: 'Consultation Scheduled', salesperson: 'Ricardo', quoteAmount: 120000,
                notes: 'HOA community pool renovation', nextAction: 'Site visit Thursday',
                nextActionDate: new Date(now + 3 * day).toISOString().slice(0, 10),
                createdAt: now - 5 * day, stageChangedAt: now - 2 * day, firstContactAt: now - 5 * day + 120000,
                lossReason: null, equipmentAge: null
            },
            {
                id: 'L1004', name: 'Amanda Garcia', email: 'agarcia@yahoo.com', phone: '210-555-0404',
                company: 'Garcia Home', address: '3456 Medical Dr', city: 'San Antonio', zip: '78229',
                lat: 29.5041, lng: -98.5536, jobType: 'Equipment Repair', source: 'Yelp',
                stage: 'Signed', salesperson: 'Richard', quoteAmount: 3200,
                notes: 'Pool pump replacement + filter install', nextAction: '',
                nextActionDate: '',
                createdAt: now - 20 * day, stageChangedAt: now - 1 * day, firstContactAt: now - 20 * day + 300000,
                lossReason: null, equipmentAge: 8
            },
            {
                id: 'L1005', name: 'David Kim', email: 'dkim@email.com', phone: '210-555-0505',
                company: 'Kim Residence', address: '7890 Huebner Rd', city: 'San Antonio', zip: '78240',
                lat: 29.5241, lng: -98.5936, jobType: 'New Pool', source: 'Home Advisor',
                stage: 'Contacted', salesperson: 'Ricardo', quoteAmount: 65000,
                notes: 'Interested in freeform pool, has 3 kids', nextAction: 'Schedule consultation',
                nextActionDate: new Date(now + day).toISOString().slice(0, 10),
                createdAt: now - 3 * day, stageChangedAt: now - 2 * day, firstContactAt: now - 3 * day + 600000,
                lossReason: null, equipmentAge: null
            },
            {
                id: 'L1006', name: 'Lisa Patel', email: 'lpatel@gmail.com', phone: '210-555-0606',
                company: 'Patel Family', address: '2345 Wurzbach Rd', city: 'San Antonio', zip: '78238',
                lat: 29.4941, lng: -98.5736, jobType: 'Remodel', source: 'Website',
                stage: 'Lost', salesperson: 'Anibal', quoteAmount: 28000,
                notes: 'Wanted deck resurfacing, went with competitor', nextAction: '',
                nextActionDate: '',
                createdAt: now - 30 * day, stageChangedAt: now - 15 * day, firstContactAt: now - 30 * day + 900000,
                lossReason: 'Went with Competitor', equipmentAge: null
            },
            {
                id: 'L1007', name: 'Marcus Johnson', email: 'mjohnson@email.com', phone: '210-555-0707',
                company: 'Johnson Pools LLC', address: '6789 Bandera Rd', city: 'San Antonio', zip: '78238',
                lat: 29.4741, lng: -98.6136, jobType: 'Service Route', source: 'Nextdoor',
                stage: 'Consultation Complete', salesperson: 'Richard', quoteAmount: 4800,
                notes: 'Weekly service for commercial property', nextAction: 'Send service agreement',
                nextActionDate: new Date(now).toISOString().slice(0, 10),
                createdAt: now - 10 * day, stageChangedAt: now - 16 * day, firstContactAt: now - 10 * day + 480000,
                lossReason: null, equipmentAge: 5
            },
            {
                id: 'L1008', name: 'Rachel Adams', email: 'radams@email.com', phone: '210-555-0808',
                company: 'Adams Residence', address: '4567 Blanco Rd', city: 'San Antonio', zip: '78212',
                lat: 29.4941, lng: -98.5036, jobType: 'New Pool', source: 'Google Ads',
                stage: 'New', salesperson: 'Anibal', quoteAmount: 72000,
                notes: 'Lap pool, modern design, budget ~$75K', nextAction: 'Initial call',
                nextActionDate: new Date(now).toISOString().slice(0, 10),
                createdAt: now - 0.5 * hr, stageChangedAt: now - 0.5 * hr, firstContactAt: null,
                lossReason: null, equipmentAge: null
            }
        ];
    }

    function getDefaultRoutes() {
        return {
            techs: [
                { name: 'Aaron', role: 'Maintenance Tech', accounts: 0, revenuePerStop: 0, laborHoursPerWeek: 0, repairsRevenue: 0, churnPerMonth: 0 },
                { name: 'Isaiah', role: 'Maintenance Tech', accounts: 0, revenuePerStop: 0, laborHoursPerWeek: 0, repairsRevenue: 0, churnPerMonth: 0 },
                { name: 'Jim', role: 'Service/Repairs Tech', accounts: 0, revenuePerStop: 0, laborHoursPerWeek: 0, repairsRevenue: 0, churnPerMonth: 0 }
            ],
            totalAccounts: 0,
            highMarginOpps: [
                { account: 'Ridgewood HOA', reason: 'Equipment 12+ years old', equipmentAge: 14, repairCount: 6 },
                { account: 'Sunset Villas', reason: 'Repeat filter/pump repairs', equipmentAge: 9, repairCount: 8 },
                { account: 'Oak Hills CC', reason: 'Commercial heater failing', equipmentAge: 11, repairCount: 4 },
                { account: 'The Dominion #47', reason: 'Salt system end of life', equipmentAge: 10, repairCount: 3 }
            ]
        };
    }

    // ========== NAVIGATION ==========
    function setupNav() {
        document.querySelectorAll('.nav-links a').forEach(a => {
            a.addEventListener('click', e => {
                e.preventDefault();
                const page = a.dataset.page;
                navigateTo(page);
            });
        });
    }

    function navigateTo(page, data) {
        document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
        const link = document.querySelector(`[data-page="${page}"]`);
        if (link) link.classList.add('active');
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        const el = document.getElementById('page-' + page);
        if (el) { el.classList.add('active'); }
        const titles = { dashboard: 'Dashboard', inbox: 'Lead Inbox', pipeline: 'Pipeline', addlead: 'Add Lead', heatmap: 'Heat Map', serviceroutes: 'Service Routes', weeklyreview: 'Weekly Review', automations: 'Automations', settings: 'Settings', leaddetail: 'Lead Detail', salesman: 'Salesman Scorecard' };
        document.getElementById('page-title').textContent = titles[page] || 'WortheyFlow';
        if (data) currentLeadId = data;
        renderPage(page);
        // close sidebar on mobile
        document.getElementById('sidebar').classList.remove('open');
        window.scrollTo(0, 0);
    }

    function renderCurrentPage() {
        const active = document.querySelector('.nav-links a.active');
        const page = active ? active.dataset.page : 'dashboard';
        renderPage(page);
    }

    function renderPage(page) {
        destroyCharts();
        // Destroy leaflet map when leaving heatmap to prevent touch capture
        if (page !== 'heatmap' && leafletMap) {
            leafletMap.remove();
            leafletMap = null;
        }
        switch (page) {
            case 'dashboard': renderDashboard(); break;
            case 'inbox': renderInbox(); break;
            case 'pipeline': renderPipeline(); break;
            case 'addlead': renderAddLead(); break;
            case 'heatmap': renderHeatmap(); break;
            case 'serviceroutes': renderServiceRoutes(); break;
            case 'weeklyreview': renderWeeklyReview(); break;
            case 'automations': renderAutomations(); break;
            case 'settings': renderSettings(); break;
            case 'leaddetail': renderLeadDetail(currentLeadId); break;
            case 'salesman': renderSalesmanScorecard(); break;
        }
    }

    function destroyCharts() {
        Object.values(charts).forEach(c => { try { c.destroy(); } catch (e) { } });
        charts = {};
    }

    // ========== SIDEBAR TOGGLE ==========
    function setupSidebarToggle() {
        document.getElementById('sidebar-toggle').addEventListener('click', () => {
            document.getElementById('sidebar').classList.toggle('open');
        });
    }

    // ========== NOTIFICATION BELL ==========
    function setupBell() {
        document.getElementById('notification-bell').addEventListener('click', () => {
            const panel = document.getElementById('notification-panel');
            panel.classList.toggle('hidden');
            if (!panel.classList.contains('hidden')) renderNotifications();
        });
        document.getElementById('notif-close').addEventListener('click', () => {
            document.getElementById('notification-panel').classList.add('hidden');
        });
    }

    // ========== LOSS MODAL ==========
    function setupLossModal() {
        document.getElementById('loss-cancel').addEventListener('click', () => {
            document.getElementById('loss-modal-overlay').classList.add('hidden');
            lossCallback = null;
        });
        document.getElementById('loss-confirm').addEventListener('click', () => {
            const reason = document.getElementById('loss-reason-select').value;
            if (!reason) { alert('Please select a loss reason.'); return; }
            document.getElementById('loss-modal-overlay').classList.add('hidden');
            if (lossCallback) lossCallback(reason);
            lossCallback = null;
        });
    }

    function showLossModal(cb) {
        document.getElementById('loss-reason-select').value = '';
        document.getElementById('loss-modal-overlay').classList.remove('hidden');
        lossCallback = cb;
    }

    // ========== DUPLICATE MODAL ==========
    function setupDupModal() {
        document.getElementById('dup-cancel').addEventListener('click', () => {
            document.getElementById('dup-modal-overlay').classList.add('hidden');
            dupCallback = null;
        });
        document.getElementById('dup-proceed').addEventListener('click', () => {
            document.getElementById('dup-modal-overlay').classList.add('hidden');
            if (dupCallback) dupCallback();
            dupCallback = null;
        });
    }

    function showDupModal(msg, cb) {
        document.getElementById('dup-modal-msg').textContent = msg;
        document.getElementById('dup-modal-overlay').classList.remove('hidden');
        dupCallback = cb;
    }

    // ========== HELPERS ==========
    function $(s) { return document.querySelector(s); }
    function $$(s) { return document.querySelectorAll(s); }
    function fmt(n) { const v = n || 0; return '$' + v.toLocaleString('en-US', { minimumFractionDigits: v % 1 !== 0 ? 2 : 0, maximumFractionDigits: 2 }); }
    function pct(n) { return (n * 100).toFixed(1) + '%'; }
    function daysBetween(a, b) { return Math.floor((b - a) / 86400000); }
    function daysInStage(lead) { return daysBetween(lead.stageChangedAt, Date.now()); }
    function daysInPipeline(lead) { return daysBetween(lead.createdAt, Date.now()); }
    function stageClass(stage) { return 'stage-' + stage.toLowerCase().replace(/\s+/g, '-'); }
    function isConstruction(jt) { return CONSTRUCTION_TYPES.includes(jt); }
    function isService(jt) { return SERVICE_TYPES.includes(jt); }
    function getProb(lead) {
        const cat = isConstruction(lead.jobType) ? 'construction' : 'service';
        return (probabilities[cat][lead.stage] || 0) / 100;
    }
    function weightedValue(lead) { return (lead.quoteAmount || 0) * getProb(lead); }
    function today() { return new Date().toISOString().slice(0, 10); }
    function weekStart() { const d = new Date(); d.setDate(d.getDate() - d.getDay()); d.setHours(0, 0, 0, 0); return d.getTime(); }
    function weekEnd() { const d = new Date(); d.setDate(d.getDate() + (6 - d.getDay())); d.setHours(23, 59, 59, 999); return d.getTime(); }
    function uid() { return 'L' + Date.now().toString(36).toUpperCase(); }

    // Auto-assignment: Pool/Remodel/Commercial rotate Ricardo↔Anibal, Service/Equipment → Richard
    let poolRotationIdx = parseInt(localStorage.getItem('wf_pool_rotation') || '0');
    function autoAssign(jobType) {
        if (CONSTRUCTION_TYPES.includes(jobType)) {
            const sp = POOL_SALESPEOPLE[poolRotationIdx % POOL_SALESPEOPLE.length];
            poolRotationIdx++;
            localStorage.setItem('wf_pool_rotation', poolRotationIdx.toString());
            return sp;
        }
        return 'Richard';
    }

    function activeLeads() { return leads.filter(l => l.stage !== 'Signed' && l.stage !== 'Lost'); }

    function daysColor(d) {
        if (d > 30) return 'red';
        if (d > 14) return 'yellow';
        return '';
    }

    function stalledLeads() {
        return leads.filter(l => l.stage !== 'Signed' && l.stage !== 'Lost' && daysInStage(l) > 14);
    }

    function responseTimeMin(lead) {
        if (!lead.firstContactAt || !lead.createdAt) return null;
        return (lead.firstContactAt - lead.createdAt) / 60000;
    }

    // ========== NOTIFICATION ENGINE ==========
    function startNotificationEngine() {
        generateNotifications();
        updateBellBadge();
        setInterval(() => { generateNotifications(); updateBellBadge(); }, 60000);
    }

    function generateNotifications() {
        const now = Date.now();
        notifications = [];
        const notifLeads = currentUser && !isAdmin() ? myLeads() : leads;
        notifLeads.forEach(l => {
            if (l.stage === 'Signed' || l.stage === 'Lost') return;
            if (!l.firstContactAt && l.stage === 'New') {
                const age = now - l.createdAt;
                if (age > 86400000) {
                    notifications.push({ id: l.id, type: 'critical', title: l.name, sub: 'Untouched >24h — CRITICAL', time: l.createdAt });
                } else if (age > 3600000) {
                    notifications.push({ id: l.id, type: 'red', title: l.name, sub: 'Untouched >1 hour', time: l.createdAt });
                } else if (age > 600000) {
                    notifications.push({ id: l.id, type: 'yellow', title: l.name, sub: 'Untouched >10 min', time: l.createdAt });
                }
            }
        });
        // sort by severity
        const order = { critical: 0, red: 1, yellow: 2 };
        notifications.sort((a, b) => order[a.type] - order[b.type]);
        saveNotifs();
    }

    function updateBellBadge() {
        const badge = document.getElementById('bell-badge');
        if (notifications.length > 0) {
            badge.textContent = notifications.length;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }

    function renderNotifications() {
        const list = document.getElementById('notif-list');
        if (notifications.length === 0) {
            list.innerHTML = '<p style="padding:20px;text-align:center;color:var(--gray-400)">No notifications 🎉</p>';
            return;
        }
        list.innerHTML = notifications.map(n => `
            <div class="notif-item" onclick="WF.viewLead('${n.id}')">
                <div class="notif-dot ${n.type}"></div>
                <div class="notif-body">
                    <div class="notif-title">${esc(n.title)}</div>
                    <div class="notif-sub">${esc(n.sub)}</div>
                    ${n.type === 'critical' ? `<button class="notif-reassign" onclick="event.stopPropagation();WF.reassign('${n.id}')">Reassign?</button>` : ''}
                </div>
            </div>
        `).join('');
    }

    function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

    // ========== DASHBOARD ==========
    function renderDashboard() {
        const el = document.getElementById('page-dashboard');
        const visibleLeads = isAdmin() ? leads : myLeads();
        const active = visibleLeads.filter(l => l.stage !== 'Signed' && l.stage !== 'Lost');
        const totalPipeline = active.reduce((s, l) => s + (l.quoteAmount || 0), 0);
        const constructionForecast = visibleLeads.filter(l => isConstruction(l.jobType) && l.stage !== 'Lost').reduce((s, l) => s + weightedValue(l), 0);
        const serviceForecast = visibleLeads.filter(l => isService(l.jobType) && l.stage !== 'Lost').reduce((s, l) => s + weightedValue(l), 0);
        const totalForecast = constructionForecast + serviceForecast;
        const hotDeals = visibleLeads.filter(l => l.stage === 'Negotiating' || l.stage === 'Proposal Sent').reduce((s, l) => s + (l.quoteAmount || 0), 0);
        const signedRevenue = visibleLeads.filter(l => l.stage === 'Signed').reduce((s, l) => s + (l.quoteAmount || 0), 0);
        const totalLeads = visibleLeads.length;
        const closedWon = visibleLeads.filter(l => l.stage === 'Signed').length;
        const closedLost = visibleLeads.filter(l => l.stage === 'Lost').length;
        const closeRate = (closedWon + closedLost) > 0 ? closedWon / (closedWon + closedLost) : 0;
        const stalled = visibleLeads.filter(l => l.stage !== 'Signed' && l.stage !== 'Lost' && daysInStage(l) > 14);
        const targetPct = monthlyTarget > 0 ? Math.min(totalForecast / monthlyTarget, 2) : 0;
        const targetPctDisplay = monthlyTarget > 0 ? (totalForecast / monthlyTarget * 100).toFixed(0) : 0;

        // Consultation complete avg value
        const ccLeads = visibleLeads.filter(l => STAGES.indexOf(l.stage) >= STAGES.indexOf('Consultation Complete') && l.quoteAmount > 0);
        const revPerCC = ccLeads.length > 0 ? ccLeads.reduce((s, l) => s + l.quoteAmount, 0) / ccLeads.length : 0;

        // Avg ticket by job type
        const avgByType = {};
        JOB_TYPES.forEach(jt => {
            const jl = visibleLeads.filter(l => l.jobType === jt && l.quoteAmount > 0);
            avgByType[jt] = jl.length > 0 ? jl.reduce((s, l) => s + l.quoteAmount, 0) / jl.length : 0;
        });

        // Close rate by job type
        const crByType = {};
        JOB_TYPES.forEach(jt => {
            const won = visibleLeads.filter(l => l.jobType === jt && l.stage === 'Signed').length;
            const lost = visibleLeads.filter(l => l.jobType === jt && l.stage === 'Lost').length;
            crByType[jt] = (won + lost) > 0 ? won / (won + lost) : 0;
        });

        // Needs attention (untouched leads sorted by urgency)
        const needsAttention = visibleLeads.filter(l => l.stage === 'New' && !l.firstContactAt).sort((a, b) => a.createdAt - b.createdAt);
        const showFinancials = isAdmin();

        el.innerHTML = `
            <div class="kpi-grid">
                ${showFinancials ? `<div class="kpi-card blue"><div class="kpi-label">Total Pipeline</div><div class="kpi-value">${fmt(totalPipeline)}</div><div class="kpi-sub">${active.length} active deals</div></div>` : `<div class="kpi-card blue"><div class="kpi-label">Active Deals</div><div class="kpi-value">${active.length}</div><div class="kpi-sub">in pipeline</div></div>`}
                ${showFinancials ? `<div class="kpi-card green"><div class="kpi-label">Weighted Forecast</div><div class="kpi-value">${fmt(totalForecast)}</div>
                    <div class="target-section">
                        <div class="target-label"><span>${targetPctDisplay}% of ${fmt(monthlyTarget)} target</span></div>
                        <div class="progress-bar-wrap"><div class="progress-bar-fill ${targetPct >= 1 ? 'over' : targetPct < 0.5 ? 'danger' : ''}" style="width:${Math.min(targetPct * 100, 100)}%"></div></div>
                    </div>
                </div>` : ''}
                ${showFinancials ? `<div class="kpi-card yellow"><div class="kpi-label">Hot Deals</div><div class="kpi-value">${fmt(hotDeals)}</div><div class="kpi-sub">Proposal Sent + Negotiating</div></div>` : `<div class="kpi-card yellow"><div class="kpi-label">Hot Deals</div><div class="kpi-value">${visibleLeads.filter(l => l.stage === 'Negotiating' || l.stage === 'Proposal Sent').length}</div><div class="kpi-sub">Proposal Sent + Negotiating</div></div>`}
                ${showFinancials ? `<div class="kpi-card green"><div class="kpi-label">Revenue Won</div><div class="kpi-value">${fmt(signedRevenue)}</div><div class="kpi-sub">${closedWon} deals signed</div></div>` : `<div class="kpi-card green"><div class="kpi-label">Deals Signed</div><div class="kpi-value">${closedWon}</div><div class="kpi-sub">closed won</div></div>`}
                <div class="kpi-card blue"><div class="kpi-label">Close Rate</div><div class="kpi-value">${pct(closeRate)}</div><div class="kpi-sub">${closedWon}W / ${closedLost}L</div></div>
                ${showFinancials ? `<div class="kpi-card blue"><div class="kpi-label">Rev / Consultation</div><div class="kpi-value">${fmt(revPerCC)}</div><div class="kpi-sub">Avg at Consultation Complete+</div></div>` : ''}
            </div>

            ${showFinancials ? `<div class="grid-2">
                <div class="card">
                    <div class="card-header"><h3>Forecast Breakdown</h3></div>
                    <div class="kpi-grid" style="margin-bottom:0">
                        <div class="kpi-card blue"><div class="kpi-label">Construction</div><div class="kpi-value">${fmt(constructionForecast)}</div></div>
                        <div class="kpi-card green"><div class="kpi-label">Service/Equipment</div><div class="kpi-value">${fmt(serviceForecast)}</div></div>
                    </div>
                </div>
                <div class="card">
                    <div class="card-header"><h3>Pipeline by Stage</h3></div>
                    <div class="chart-container"><canvas id="chart-pipeline-stage"></canvas></div>
                </div>
            </div>` : `<div class="card"><div class="card-header"><h3>Pipeline by Stage</h3></div><div class="chart-container"><canvas id="chart-pipeline-stage"></canvas></div></div>`}

            ${showFinancials ? `<div class="grid-2">
                <div class="card">
                    <div class="card-header"><h3>Avg Ticket by Job Type</h3></div>
                    <div class="chart-container"><canvas id="chart-avg-ticket"></canvas></div>
                </div>
                <div class="card">
                    <div class="card-header"><h3>Close Rate by Job Type</h3></div>
                    <div class="chart-container"><canvas id="chart-close-rate"></canvas></div>
                </div>
            </div>` : ''}

            <div class="grid-2">
                <div class="card">
                    <div class="card-header"><h3>⚠️ Stalled Deals (>14 days in stage)</h3></div>
                    ${stalled.length === 0 ? '<p style="color:var(--gray-400)">No stalled deals 🎉</p>' :
                stalled.map(l => `
                        <div class="stalled-item" style="cursor:pointer" onclick="WF.viewLead('${l.id}')">
                            <div><strong>${esc(l.name)}</strong> — ${l.stage} <span class="badge ${stageClass(l.stage)}">${l.stage}</span></div>
                            <div class="stalled-days ${daysColor(daysInStage(l))}">${daysInStage(l)}d</div>
                        </div>
                    `).join('')}
                </div>
                <div class="card">
                    <div class="card-header"><h3>🚨 Leads Needing Attention</h3></div>
                    ${needsAttention.length === 0 ? '<p style="color:var(--gray-400)">All leads contacted 🎉</p>' :
                needsAttention.map(l => {
                    const ageMin = Math.floor((Date.now() - l.createdAt) / 60000);
                    let urgency = 'badge-green';
                    if (ageMin > 1440) urgency = 'badge-red';
                    else if (ageMin > 60) urgency = 'badge-yellow';
                    else if (ageMin > 10) urgency = 'badge-yellow';
                    const ageStr = ageMin >= 1440 ? Math.floor(ageMin / 1440) + 'd' : ageMin >= 60 ? Math.floor(ageMin / 60) + 'h' : ageMin + 'm';
                    return `<div class="stalled-item" style="cursor:pointer" onclick="WF.viewLead('${l.id}')">
                                <div><strong>${esc(l.name)}</strong> — ${l.salesperson}</div>
                                <span class="badge ${urgency}">${ageStr} ago</span>
                            </div>`;
                }).join('')}
                </div>
            </div>

            ${showFinancials ? `<div class="card">
                <div class="card-header"><h3>👥 Salesman Summary</h3><button class="btn btn-sm btn-primary" onclick="WF.navigateTo('salesman')">Full Scorecard →</button></div>
                <div class="table-wrap"><table>
                    <tr><th>Salesperson</th><th>Leads</th><th>Close Rate</th><th>Revenue</th><th>Pipeline</th><th>Stalled</th></tr>
                    ${SALESPEOPLE.map(sp => {
                const sLeads = visibleLeads.filter(l => l.salesperson === sp);
                const sWon = sLeads.filter(l => l.stage === 'Signed').length;
                const sLost = sLeads.filter(l => l.stage === 'Lost').length;
                const sCR = (sWon + sLost) > 0 ? sWon / (sWon + sLost) : 0;
                const sRev = sLeads.filter(l => l.stage === 'Signed').reduce((s, l) => s + (l.quoteAmount || 0), 0);
                const sPipe = sLeads.filter(l => l.stage !== 'Signed' && l.stage !== 'Lost').length;
                const sStalled = sLeads.filter(l => l.stage !== 'Signed' && l.stage !== 'Lost' && daysInStage(l) > 14).length;
                return `<tr><td><strong>${esc(sp)}</strong></td><td>${sLeads.length}</td><td class="${sCR < 0.2 ? 'weakness' : ''}">${pct(sCR)}</td><td>${fmt(sRev)}</td><td>${sPipe}</td><td class="${sStalled > 0 ? 'weakness' : ''}">${sStalled}</td></tr>`;
            }).join('')}
                </table></div>
            </div>` : ''}
        `;

        // Charts
        renderPipelineStageChart(visibleLeads);
        if (showFinancials) { renderAvgTicketChart(avgByType); renderCloseRateChart(crByType); }
    }

    function renderPipelineStageChart(srcLeads) {
        const ctx = document.getElementById('chart-pipeline-stage');
        if (!ctx) return;
        const useLeads = srcLeads || leads;
        const data = STAGES.filter(s => s !== 'Lost' && s !== 'Signed').map(s => useLeads.filter(l => l.stage === s).length);
        charts.pipelineStage = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: STAGES.filter(s => s !== 'Lost' && s !== 'Signed'),
                datasets: [{ label: 'Leads', data, backgroundColor: '#3b82f6', borderRadius: 4 }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }
        });
    }

    function renderAvgTicketChart(avgByType) {
        const ctx = document.getElementById('chart-avg-ticket');
        if (!ctx) return;
        charts.avgTicket = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: JOB_TYPES,
                datasets: [{ label: 'Avg Ticket', data: JOB_TYPES.map(jt => avgByType[jt]), backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444'], borderRadius: 4 }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { callback: v => '$' + v.toLocaleString() } } } }
        });
    }

    function renderCloseRateChart(crByType) {
        const ctx = document.getElementById('chart-close-rate');
        if (!ctx) return;
        charts.closeRate = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: JOB_TYPES,
                datasets: [{ label: 'Close Rate', data: JOB_TYPES.map(jt => (crByType[jt] * 100).toFixed(1)), backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444'], borderRadius: 4 }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, max: 100, ticks: { callback: v => v + '%' } } } }
        });
    }

    // ========== LEAD INBOX ==========
    function renderInbox() {
        const el = document.getElementById('page-inbox');
        el.innerHTML = `
            <div class="filter-bar">
                <button class="filter-btn ${currentFilter === 'all' ? 'active' : ''}" onclick="WF.setFilter('all')">All Leads</button>
                <button class="filter-btn ${currentFilter === 'today' ? 'active' : ''}" onclick="WF.setFilter('today')">Today's Follow-ups</button>
                <button class="filter-btn ${currentFilter === 'hot7' ? 'active' : ''}" onclick="WF.setFilter('hot7')">Hot 7-Day Leads</button>
                <button class="filter-btn ${currentFilter === 'uncontacted' ? 'active' : ''}" onclick="WF.setFilter('uncontacted')">Uncontacted</button>
                <button class="filter-btn ${currentFilter === 'proposal_nr' ? 'active' : ''}" onclick="WF.setFilter('proposal_nr')">Proposal – No Response</button>
                <button class="filter-btn ${currentFilter === 'high_value' ? 'active' : ''}" onclick="WF.setFilter('high_value')">High Value (>$50K)</button>
                <button class="filter-btn ${currentFilter === 'stalled' ? 'active' : ''}" onclick="WF.setFilter('stalled')">Stalled</button>
            </div>
            <div class="card">
                <div class="table-wrap">
                    <table id="inbox-table">
                        <thead><tr>
                            <th>Name</th><th>Job Type</th><th>Stage</th><th>Value</th><th>Salesperson</th><th>Days in Stage</th><th>Next Action</th><th>Source</th>
                        </tr></thead>
                        <tbody id="inbox-body"></tbody>
                    </table>
                </div>
            </div>
        `;
        renderInboxRows();
    }

    function getFilteredLeads() {
        const now = Date.now();
        const day = 86400000;
        const base = isAdmin() ? leads : myLeads();
        switch (currentFilter) {
            case 'today': return base.filter(l => l.nextActionDate === today());
            case 'hot7': return base.filter(l => l.stage !== 'Lost' && l.stage !== 'Signed' && (now - l.createdAt) < 7 * day);
            case 'uncontacted': return base.filter(l => !l.firstContactAt);
            case 'proposal_nr': return base.filter(l => l.stage === 'Proposal Sent' && daysInStage(l) > 7);
            case 'high_value': return base.filter(l => (l.quoteAmount || 0) > 50000);
            case 'stalled': return base.filter(l => l.stage !== 'Signed' && l.stage !== 'Lost' && daysInStage(l) > 14);
            default: return [...base];
        }
    }

    function renderInboxRows() {
        const tbody = document.getElementById('inbox-body');
        if (!tbody) return;
        const filtered = getFilteredLeads();
        tbody.innerHTML = filtered.map(l => {
            const dis = daysInStage(l);
            const dc = daysColor(dis);
            return `<tr class="clickable" onclick="WF.viewLead('${l.id}')">
                <td><strong>${esc(l.name)}</strong><br><small style="color:var(--gray-400)">${esc(l.company || '')}</small></td>
                <td>${esc(l.jobType)}</td>
                <td><span class="badge ${stageClass(l.stage)}">${l.stage}</span></td>
                <td>${fmt(l.quoteAmount)}</td>
                <td>${esc(l.salesperson)}</td>
                <td class="${dc}" style="font-weight:600">${dis}d</td>
                <td>${esc(l.nextAction || '—')}<br><small>${l.nextActionDate || ''}</small></td>
                <td>${esc(l.source)}</td>
            </tr>`;
        }).join('');
    }

    // ========== PIPELINE (Kanban) ==========
    function renderPipeline() {
        const el = document.getElementById('page-pipeline');
        el.innerHTML = `<div class="kanban-board" id="kanban-board"></div>`;
        const board = document.getElementById('kanban-board');
        const pipelineLeads = isAdmin() ? leads : myLeads();
        STAGES.forEach(stage => {
            const col = document.createElement('div');
            col.className = 'kanban-column';
            col.dataset.stage = stage;
            const stageLeads = pipelineLeads.filter(l => l.stage === stage);
            const totalVal = stageLeads.reduce((s, l) => s + (l.quoteAmount || 0), 0);
            col.innerHTML = `
                <div class="kanban-column-header">
                    <h4>${stage}</h4>
                    <span class="kanban-count">${stageLeads.length} · ${fmt(totalVal)}</span>
                </div>
                <div class="kanban-cards" data-stage="${stage}">
                    ${stageLeads.map(l => {
                const dis = daysInStage(l);
                const dc = daysColor(dis);
                return `<div class="kanban-card" data-id="${l.id}" onclick="WF.viewLead('${l.id}')">
                            <div class="kc-name">${esc(l.name)}</div>
                            <div class="kc-company">${esc(l.company || '')}</div>
                            <div class="kc-value">${fmt(l.quoteAmount)}</div>
                            <div class="kc-meta">
                                <span class="kc-jobtype badge badge-gray">${l.jobType}</span>
                                <span class="kc-days ${dc}">${dis}d in stage</span>
                            </div>
                        </div>`;
            }).join('')}
                </div>
            `;
            board.appendChild(col);
        });

        // SortableJS
        document.querySelectorAll('.kanban-cards').forEach(container => {
            new Sortable(container, {
                group: 'kanban',
                animation: 200,
                ghostClass: 'dragging',
                onEnd: function (evt) {
                    const leadId = evt.item.dataset.id;
                    const newStage = evt.to.dataset.stage;
                    changeStage(leadId, newStage);
                }
            });
        });
    }

    function changeStage(leadId, newStage, skipChecks) {
        const lead = leads.find(l => l.id === leadId);
        if (!lead) return;
        const oldStage = lead.stage;
        if (oldStage === newStage) return;

        // Validation: need deal value past Consultation Complete
        if (!skipChecks) {
            const newIdx = STAGES.indexOf(newStage);
            const ccIdx = STAGES.indexOf('Consultation Complete');
            if (newIdx > ccIdx && newStage !== 'Lost' && (!lead.quoteAmount || lead.quoteAmount <= 0)) {
                alert('⚠️ Cannot advance past "Consultation Complete" without a deal value. Please add a quote amount first.');
                renderPipeline();
                return;
            }
        }

        // Loss reason
        if (newStage === 'Lost') {
            showLossModal(reason => {
                lead.lossReason = reason;
                lead.stage = newStage;
                lead.stageChangedAt = Date.now();
                lead.nextAction = '';
                lead.nextActionDate = '';
                saveLeads();
                generateNotifications();
                updateBellBadge();
                fireAutomationTrigger({ type: 'stage_change', oldStage, newStage }, lead);
                renderPipeline();
            });
            renderPipeline();
            return;
        }

        // Require next action for non-terminal stages
        if (newStage !== 'Signed' && newStage !== 'Lost' && !lead.nextAction) {
            const action = prompt('Next Action required for stage "' + newStage + '":');
            if (!action) { renderPipeline(); return; }
            lead.nextAction = action;
        }

        lead.stage = newStage;
        lead.stageChangedAt = Date.now();
        if (newStage === 'Signed') { lead.nextAction = ''; lead.nextActionDate = ''; }
        if (oldStage === 'New' && newStage === 'Contacted' && !lead.firstContactAt) {
            lead.firstContactAt = Date.now();
        }
        saveLeads();
        generateNotifications();
        updateBellBadge();
        fireAutomationTrigger({ type: 'stage_change', oldStage, newStage }, lead);
        renderPipeline();
    }

    // ========== ADD LEAD ==========
    function renderAddLead() {
        const el = document.getElementById('page-addlead');
        el.innerHTML = `
            <div class="card" style="max-width:700px">
                <h3 style="margin-bottom:20px">Add New Lead</h3>
                <div id="add-lead-errors"></div>
                <form id="add-lead-form" onsubmit="return WF.submitLead(event)">
                    <div class="form-row">
                        <div class="form-group"><label>Name <span class="required">*</span></label><input class="form-control" id="al-name" required></div>
                        <div class="form-group"><label>Company</label><input class="form-control" id="al-company"></div>
                    </div>
                    <div class="form-row">
                        <div class="form-group"><label>Phone</label><input class="form-control" id="al-phone" placeholder="210-555-0000"></div>
                        <div class="form-group"><label>Email (His) <span class="required">*</span></label><input class="form-control" id="al-email" type="email" required></div>
                        <div class="form-group"><label>Email (Hers)</label><input class="form-control" id="al-email2" type="email"></div>
                    </div>
                    <div class="form-row-3">
                        <div class="form-group"><label>Address</label><input class="form-control" id="al-address"></div>
                        <div class="form-group"><label>City</label><input class="form-control" id="al-city" value="San Antonio"></div>
                        <div class="form-group"><label>ZIP <span class="required">*</span></label><input class="form-control" id="al-zip" required pattern="\\d{5}" maxlength="5" placeholder="78XXX"></div>
                    </div>
                    <div class="form-row-3">
                        <div class="form-group"><label>Job Type <span class="required">*</span></label>
                            <select class="form-control" id="al-jobtype" required>
                                <option value="">Select…</option>
                                ${(isService() ? SERVICE_TYPES : JOB_TYPES).map(j => `<option value="${j}">${j}</option>`).join('')}
                            </select>
                        </div>
                        <div class="form-group"><label>Source <span class="required">*</span></label>
                            <select class="form-control" id="al-source" required>
                                <option value="">Select…</option>
                                ${SOURCES.map(s => `<option value="${s}">${s}</option>`).join('')}
                            </select>
                        </div>
                        ${isAdmin() ? `<div class="form-group"><label>Salesperson <span class="required">*</span></label>
                            <select class="form-control" id="al-salesperson" required>
                                <option value="">Auto-assign</option>
                                ${SALESPEOPLE.map(s => `<option value="${s}">${s}</option>`).join('')}
                            </select>
                            <small style="color:var(--gray-500);font-size:11px">Auto-assigns based on job type if left blank</small>
                        </div>` : `<input type="hidden" id="al-salesperson" value="${currentUser ? currentUser.salesperson : ''}">`}
                    </div>
                    <div class="form-row">
                        <div class="form-group"><label>Quote Amount ($)</label><input class="form-control" id="al-quote" type="number" min="0" step="0.01"></div>
                    </div>

                    <!-- Dynamic fields based on job type -->
                    <div id="al-dynamic-fields"></div>
                    <div class="form-row">
                        <div class="form-group"><label>Next Action <span class="required">*</span></label><input class="form-control" id="al-nextaction" required placeholder="e.g. Initial call"></div>
                        <div class="form-group"><label>Next Action Date</label><input class="form-control" id="al-nextdate" type="date" value="${today()}"></div>
                    </div>
                    <div class="form-group"><label>Notes</label><textarea class="form-control" id="al-notes" rows="3"></textarea></div>
                    <button type="submit" class="btn btn-primary" style="margin-top:8px">Add Lead</button>
                </form>
            </div>
        `;
        document.getElementById('al-jobtype').addEventListener('change', updateDynamicFields);
    }

    const EQUIPMENT_TYPES = ['Pump', 'Filter', 'Heater', 'Salt System', 'Chlorinator', 'Automation/Controls', 'LED Lighting', 'Cleaner', 'Cover', 'Plumbing', 'Other'];

    function updateDynamicFields() {
        const jt = document.getElementById('al-jobtype').value;
        const container = document.getElementById('al-dynamic-fields');
        if (!container) return;

        if (CONSTRUCTION_TYPES.includes(jt)) {
            // New Pool / Remodel / Commercial fields
            container.innerHTML = `
                <div class="form-row-3">
                    <div class="form-group"><label>Pool Type</label>
                        <select class="form-control" id="al-pool-type">
                            <option value="">Select…</option>
                            <option value="Gunite/Shotcrete">Gunite/Shotcrete</option>
                            <option value="Fiberglass">Fiberglass</option>
                            <option value="Vinyl">Vinyl</option>
                            <option value="Commercial">Commercial</option>
                        </select>
                    </div>
                    <div class="form-group"><label>Pool Size (approx)</label>
                        <select class="form-control" id="al-pool-size">
                            <option value="">Select…</option>
                            <option value="Small (<300 sq ft)">Small (&lt;300 sq ft)</option>
                            <option value="Medium (300-500 sq ft)">Medium (300-500 sq ft)</option>
                            <option value="Large (500-800 sq ft)">Large (500-800 sq ft)</option>
                            <option value="XL (800+ sq ft)">XL (800+ sq ft)</option>
                        </select>
                    </div>
                    <div class="form-group"><label>Features</label>
                        <input class="form-control" id="al-features" placeholder="Spa, waterfall, fire bowls…">
                    </div>
                </div>
            `;
        } else if (SERVICE_TYPES.includes(jt)) {
            // Service Route / Equipment Repair fields
            container.innerHTML = `
                <div class="form-row-3">
                    <div class="form-group"><label>Pool Age (years)</label>
                        <input class="form-control" id="al-pool-age" type="number" min="0" placeholder="e.g. 12">
                    </div>
                    <div class="form-group"><label>Equipment Type</label>
                        <select class="form-control" id="al-equip-type">
                            <option value="">Select…</option>
                            ${EQUIPMENT_TYPES.map(t => `<option value="${t}">${t}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group"><label>Equipment Age (years)</label>
                        <input class="form-control" id="al-equip-age" type="number" min="0" placeholder="e.g. 8">
                    </div>
                </div>
            `;
        } else {
            container.innerHTML = '';
        }
    }

    function submitLead(e) {
        e.preventDefault();
        const errDiv = document.getElementById('add-lead-errors');
        errDiv.innerHTML = '';
        const phone = document.getElementById('al-phone').value.trim();
        const email = document.getElementById('al-email').value.trim();
        const email2 = document.getElementById('al-email2').value.trim();
        const zip = document.getElementById('al-zip').value.trim();

        // Email is required (enforced by form), phone is optional but recommended
        if (!phone && !email) {
            errDiv.innerHTML = '<div class="form-warning">⚠️ Missing contact info — please provide phone or email.</div>';
            return false;
        }

        // Validate ZIP
        if (!/^\d{5}$/.test(zip)) {
            errDiv.innerHTML = '<div class="form-error">ZIP must be exactly 5 digits.</div>';
            return false;
        }

        // Duplicate check
        const dupes = [];
        if (phone) {
            const existing = leads.find(l => l.phone === phone);
            if (existing) dupes.push(`Phone "${phone}" already exists (${existing.name})`);
        }
        if (email) {
            const existing = leads.find(l => l.email && l.email.toLowerCase() === email.toLowerCase());
            if (existing) dupes.push(`Email "${email}" already exists (${existing.name})`);
        }

        const doAdd = () => {
            const lead = {
                id: uid(),
                name: document.getElementById('al-name').value.trim(),
                company: document.getElementById('al-company').value.trim(),
                phone, email,
                address: document.getElementById('al-address').value.trim(),
                city: document.getElementById('al-city').value.trim(),
                zip,
                lat: 29.4241 + (Math.random() - 0.5) * 0.15,
                lng: -98.4936 + (Math.random() - 0.5) * 0.15,
                email2: email2,
                jobType: document.getElementById('al-jobtype').value,
                source: document.getElementById('al-source').value,
                salesperson: document.getElementById('al-salesperson').value || autoAssign(document.getElementById('al-jobtype').value),
                stage: 'New',
                quoteAmount: parseFloat(document.getElementById('al-quote').value) || 0,
                equipmentAge: document.getElementById('al-equip-age') ? (parseInt(document.getElementById('al-equip-age').value) || null) : null,
                poolAge: document.getElementById('al-pool-age') ? (parseInt(document.getElementById('al-pool-age').value) || null) : null,
                equipmentType: document.getElementById('al-equip-type') ? document.getElementById('al-equip-type').value : '',
                poolType: document.getElementById('al-pool-type') ? document.getElementById('al-pool-type').value : '',
                poolSize: document.getElementById('al-pool-size') ? document.getElementById('al-pool-size').value : '',
                features: document.getElementById('al-features') ? document.getElementById('al-features').value.trim() : '',
                nextAction: document.getElementById('al-nextaction').value.trim(),
                nextActionDate: document.getElementById('al-nextdate').value,
                notes: document.getElementById('al-notes').value.trim(),
                createdAt: Date.now(),
                stageChangedAt: Date.now(),
                firstContactAt: null,
                lossReason: null
            };
            leads.push(lead);
            saveLeads();
            generateNotifications();
            updateBellBadge();
            fireAutomationTrigger({ type: 'lead_created' }, lead);
            alert('Lead added: ' + lead.name);
            navigateTo('inbox');
        };

        if (dupes.length > 0) {
            showDupModal(dupes.join('. '), doAdd);
        } else {
            doAdd();
        }
        return false;
    }

    // ========== LEAD DETAIL ==========
    function renderLeadDetail(id) {
        const lead = leads.find(l => l.id === id);
        if (!lead) { navigateTo('inbox'); return; }
        const el = document.getElementById('page-leaddetail');
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        el.classList.add('active');
        document.getElementById('page-title').textContent = lead.name;

        const dis = daysInStage(lead);
        const dip = daysInPipeline(lead);
        const dc = daysColor(dis);
        const rt = responseTimeMin(lead);

        el.innerHTML = `
            <div class="lead-detail-header">
                <div>
                    <h2>${esc(lead.name)}</h2>
                    <p style="color:var(--gray-500)">${esc(lead.company || '')} · ${esc(lead.jobType)} · ${esc(lead.source)}</p>
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap">
                    <span class="badge ${stageClass(lead.stage)}" style="font-size:14px;padding:6px 14px">${lead.stage}</span>
                    <button class="btn btn-sm btn-secondary" onclick="WF.navigateTo('inbox')">← Back</button>
                    ${isAdmin() ? `<button class="btn btn-sm btn-danger" onclick="WF.deleteLead('${lead.id}')">Delete</button>` : ''}
                </div>
            </div>

            <div class="kpi-grid" style="margin-bottom:20px">
                ${isAdmin() ? `<div class="kpi-card blue"><div class="kpi-label">Deal Value</div><div class="kpi-value">${fmt(lead.quoteAmount)}</div></div>` : ''}
                <div class="kpi-card ${dc === 'red' ? 'red' : dc === 'yellow' ? 'yellow' : 'blue'}"><div class="kpi-label">Days in Stage</div><div class="kpi-value">${dis}d</div></div>
                <div class="kpi-card blue"><div class="kpi-label">Total Days in Pipeline</div><div class="kpi-value">${dip}d</div></div>
                <div class="kpi-card green"><div class="kpi-label">Response Time</div><div class="kpi-value">${rt !== null ? (rt < 60 ? rt.toFixed(0) + 'm' : (rt / 60).toFixed(1) + 'h') : 'N/A'}</div></div>
            </div>

            <div class="grid-2">
                <div class="card">
                    <h3 style="margin-bottom:12px">Contact Info</h3>
                    <div class="lead-detail-grid">
                        <div class="lead-field"><label>Phone</label><div class="field-value">${lead.phone ? `<a href="tel:${lead.phone}">${esc(lead.phone)}</a>` : '—'}</div></div>
                        <div class="lead-field"><label>Email (His)</label><div class="field-value">${lead.email ? `<a href="mailto:${lead.email}">${esc(lead.email)}</a>` : '—'}</div></div>
                        <div class="lead-field"><label>Email (Hers)</label><div class="field-value">${lead.email2 ? `<a href="mailto:${lead.email2}">${esc(lead.email2)}</a>` : '—'}</div></div>
                        <div class="lead-field"><label>Address</label><div class="field-value">${esc(lead.address || '—')}</div></div>
                        <div class="lead-field"><label>City / ZIP</label><div class="field-value">${esc(lead.city || '')} ${esc(lead.zip || '')}</div></div>
                    </div>
                </div>
                <div class="card">
                    <h3 style="margin-bottom:12px">Deal Info</h3>
                    <div class="lead-detail-grid">
                        <div class="lead-field"><label>Salesperson</label><div class="field-value">${esc(lead.salesperson)}</div></div>
                        ${isAdmin() ? `<div class="lead-field"><label>Weighted Value</label><div class="field-value">${fmt(weightedValue(lead))}</div></div>` : ''}
                        <div class="lead-field"><label>Equipment Age</label><div class="field-value">${lead.equipmentAge ? lead.equipmentAge + ' years' : '—'}</div></div>
                        <div class="lead-field"><label>Loss Reason</label><div class="field-value">${lead.lossReason ? esc(lead.lossReason) : '—'}</div></div>
                    </div>
                </div>
            </div>

            <div class="card">
                <h3 style="margin-bottom:12px">Edit Lead</h3>
                <form onsubmit="return WF.updateLead(event, '${lead.id}')">
                    <div class="form-row-3">
                        <div class="form-group"><label>Stage</label>
                            <select class="form-control" id="ld-stage">
                                ${STAGES.map(s => `<option value="${s}" ${s === lead.stage ? 'selected' : ''}>${s}</option>`).join('')}
                            </select>
                        </div>
                        <div class="form-group"><label>Quote Amount</label><input class="form-control" id="ld-quote" type="number" value="${lead.quoteAmount || 0}" min="0" step="0.01"></div>
                        ${isAdmin() ? `<div class="form-group"><label>Salesperson</label>
                            <select class="form-control" id="ld-salesperson">
                                ${SALESPEOPLE.map(s => `<option value="${s}" ${s === lead.salesperson ? 'selected' : ''}>${s}</option>`).join('')}
                            </select>
                        </div>` : `<input type="hidden" id="ld-salesperson" value="${esc(lead.salesperson)}">`}
                    </div>
                    <div class="form-row">
                        <div class="form-group"><label>Next Action</label><input class="form-control" id="ld-nextaction" value="${esc(lead.nextAction || '')}"></div>
                        <div class="form-group"><label>Next Action Date</label><input class="form-control" id="ld-nextdate" type="date" value="${lead.nextActionDate || ''}"></div>
                    </div>
                    <div class="form-group"><label>Notes</label><textarea class="form-control" id="ld-notes" rows="3">${esc(lead.notes || '')}</textarea></div>
                    <div id="ld-errors"></div>
                    <button type="submit" class="btn btn-primary">Save Changes</button>
                </form>
            </div>

            <!-- Mobile Fast Edit Bar -->
            <div class="fast-edit-bar" id="fast-edit">
                <div class="fast-edit-actions">
                    ${lead.phone ? `<a href="tel:${lead.phone}"><span class="fe-icon">📞</span>Call</a>` : '<span></span>'}
                    ${lead.phone ? `<a href="sms:${lead.phone}"><span class="fe-icon">💬</span>Text</a>` : '<span></span>'}
                    <button onclick="document.getElementById('ld-nextaction').focus()"><span class="fe-icon">📝</span>Action</button>
                    <button onclick="document.getElementById('ld-stage').focus()"><span class="fe-icon">🔄</span>Stage</button>
                </div>
                <div class="fast-edit-row">
                    <select id="fe-stage" onchange="document.getElementById('ld-stage').value=this.value">
                        ${STAGES.map(s => `<option value="${s}" ${s === lead.stage ? 'selected' : ''}>${s}</option>`).join('')}
                    </select>
                    <input type="text" id="fe-note" placeholder="Quick note…" onkeydown="if(event.key==='Enter'){WF.quickNote('${lead.id}',this.value);this.value=''}">
                </div>
            </div>
        `;
    }

    function updateLead(e, id) {
        e.preventDefault();
        const lead = leads.find(l => l.id === id);
        if (!lead) return false;
        const errDiv = document.getElementById('ld-errors');
        errDiv.innerHTML = '';

        const newStage = document.getElementById('ld-stage').value;
        const newQuote = parseFloat(document.getElementById('ld-quote').value) || 0;
        const newAction = document.getElementById('ld-nextaction').value.trim();

        // Validate: can't advance past CC without deal value
        const newIdx = STAGES.indexOf(newStage);
        const ccIdx = STAGES.indexOf('Consultation Complete');
        if (newIdx > ccIdx && newStage !== 'Lost' && newQuote <= 0) {
            errDiv.innerHTML = '<div class="form-error">⚠️ Cannot advance past "Consultation Complete" without a deal value.</div>';
            return false;
        }

        // Require next action for non-terminal
        if (newStage !== 'Signed' && newStage !== 'Lost' && !newAction) {
            errDiv.innerHTML = '<div class="form-error">Next Action is required for stage "' + newStage + '".</div>';
            return false;
        }

        // Loss reason
        if (newStage === 'Lost' && lead.stage !== 'Lost') {
            showLossModal(reason => {
                lead.lossReason = reason;
                finishUpdate(lead, newStage, newQuote, newAction);
            });
            return false;
        }

        finishUpdate(lead, newStage, newQuote, newAction);
        return false;
    }

    function finishUpdate(lead, newStage, newQuote, newAction) {
        const oldStage = lead.stage;
        if (oldStage !== newStage) {
            lead.stageChangedAt = Date.now();
            if (oldStage === 'New' && newStage === 'Contacted' && !lead.firstContactAt) {
                lead.firstContactAt = Date.now();
            }
        }
        lead.stage = newStage;
        lead.quoteAmount = newQuote;
        lead.nextAction = newAction;
        lead.nextActionDate = document.getElementById('ld-nextdate').value;
        lead.salesperson = document.getElementById('ld-salesperson').value;
        lead.notes = document.getElementById('ld-notes').value;
        if (newStage === 'Signed' || newStage === 'Lost') {
            lead.nextAction = '';
            lead.nextActionDate = '';
        }
        saveLeads();
        generateNotifications();
        updateBellBadge();
        if (oldStage !== newStage) {
            fireAutomationTrigger({ type: 'stage_change', oldStage, newStage }, lead);
        }
        alert('Lead updated.');
        renderLeadDetail(lead.id);
    }

    function quickNote(id, note) {
        if (!note.trim()) return;
        const lead = leads.find(l => l.id === id);
        if (!lead) return;
        lead.notes = (lead.notes ? lead.notes + '\n' : '') + '[' + new Date().toLocaleString() + '] ' + note.trim();
        saveLeads();
        alert('Note added.');
    }

    function deleteLead(id) {
        if (!confirm('Delete this lead?')) return;
        leads = leads.filter(l => l.id !== id);
        saveLeads();
        navigateTo('inbox');
    }

    // ========== HEATMAP ==========
    function getMapCategory(l) {
        const isPool = CONSTRUCTION_TYPES.includes(l.jobType);
        const isMaint = SERVICE_TYPES.includes(l.jobType);
        if (isPool && l.stage === 'Signed') return { cat: 'Sold Pool Customers', color: '#10b981' }; // green
        if (isPool && l.stage !== 'Lost') return { cat: 'New Pool Leads', color: '#3b82f6' }; // blue
        if (isMaint && l.stage === 'Signed') return { cat: 'Existing Maint. Customers', color: '#f59e0b' }; // amber
        if (isMaint && l.stage !== 'Lost') return { cat: 'New Maint. Leads', color: '#8b5cf6' }; // purple
        return { cat: 'Lost', color: '#ef4444' }; // red
    }

    function renderHeatmap() {
        const el = document.getElementById('page-heatmap');
        el.innerHTML = `
            <div class="card" style="margin-bottom:12px;padding:12px 16px">
                <div style="display:flex;flex-wrap:wrap;gap:16px;align-items:center">
                    <strong style="font-size:13px">Legend:</strong>
                    <span style="display:flex;align-items:center;gap:4px;font-size:13px"><span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:#10b981"></span> Sold Pool Customers</span>
                    <span style="display:flex;align-items:center;gap:4px;font-size:13px"><span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:#3b82f6"></span> New Pool Leads</span>
                    <span style="display:flex;align-items:center;gap:4px;font-size:13px"><span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:#f59e0b"></span> Existing Maint. Customers</span>
                    <span style="display:flex;align-items:center;gap:4px;font-size:13px"><span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:#8b5cf6"></span> New Maint. Leads</span>
                    <span style="display:flex;align-items:center;gap:4px;font-size:13px"><span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:#ef4444"></span> Lost</span>
                </div>
            </div>
            <div class="card"><div id="map"></div></div>`;
        setTimeout(() => {
            if (leafletMap) { leafletMap.remove(); leafletMap = null; }
            leafletMap = L.map('map').setView(SA_CENTER, 11);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap'
            }).addTo(leafletMap);
            const mapLeads = isAdmin() ? leads : myLeads();
            mapLeads.forEach(l => {
                if (!l.lat || !l.lng) return;
                const { cat, color } = getMapCategory(l);
                const marker = L.circleMarker([l.lat, l.lng], { radius: 8, fillColor: color, color: '#fff', weight: 2, fillOpacity: 0.8 })
                    .addTo(leafletMap)
                    .bindPopup(`<strong>${esc(l.name)}</strong><br>${cat}<br>${l.stage} · ${l.jobType}<br>${fmt(l.quoteAmount)}`);
                marker.on('click', () => { viewLead(l.id); });
            });
        }, 100);
    }

    // ========== SERVICE ROUTES ==========
    function renderServiceRoutes() {
        const el = document.getElementById('page-serviceroutes');
        const r = serviceRouteData;
        const totalRevPerWeek = r.techs.reduce((s, t) => s + (t.accounts * t.revenuePerStop), 0);
        const totalLabor = r.techs.reduce((s, t) => s + t.laborHoursPerWeek, 0);
        const totalRepairs = r.techs.reduce((s, t) => s + t.repairsRevenue, 0);
        const avgChurn = r.techs.reduce((s, t) => s + t.churnPerMonth, 0) / r.techs.length;
        const avgRevPerStop = totalRevPerWeek / r.totalAccounts;

        el.innerHTML = `
            <div class="kpi-grid">
                <div class="kpi-card blue"><div class="kpi-label">Total Accounts</div><div class="kpi-value">${r.totalAccounts}</div></div>
                <div class="kpi-card green"><div class="kpi-label">Weekly Revenue</div><div class="kpi-value">${fmt(totalRevPerWeek)}</div></div>
                <div class="kpi-card blue"><div class="kpi-label">Avg Rev/Stop</div><div class="kpi-value">${fmt(avgRevPerStop)}</div></div>
                <div class="kpi-card yellow"><div class="kpi-label">Repairs Revenue</div><div class="kpi-value">${fmt(totalRepairs)}/mo</div></div>
                <div class="kpi-card blue"><div class="kpi-label">Total Labor</div><div class="kpi-value">${totalLabor}h/wk</div></div>
                <div class="kpi-card red"><div class="kpi-label">Avg Churn</div><div class="kpi-value">${avgChurn.toFixed(1)}/mo</div></div>
            </div>

            <h3 style="margin-bottom:12px">Tech Routes</h3>
            ${r.techs.map(t => `
                <div class="route-card">
                    <div class="route-header">
                        <h4>🔧 ${esc(t.name)}${t.role ? ` <span style="font-size:12px;font-weight:400;color:var(--gray-400)">— ${esc(t.role)}</span>` : ''}</h4>
                        <span class="badge badge-blue">${t.accounts} accounts</span>
                    </div>
                    <div class="route-stats">
                        <div class="route-stat"><div class="rs-label">Rev/Stop</div><div class="rs-value">${fmt(t.revenuePerStop)}</div></div>
                        <div class="route-stat"><div class="rs-label">Weekly Rev</div><div class="rs-value">${fmt(t.accounts * t.revenuePerStop)}</div></div>
                        <div class="route-stat"><div class="rs-label">Labor Hrs/Wk</div><div class="rs-value">${t.laborHoursPerWeek}h</div></div>
                        <div class="route-stat"><div class="rs-label">Repairs Rev/Mo</div><div class="rs-value">${fmt(t.repairsRevenue)}</div></div>
                        <div class="route-stat"><div class="rs-label">Churn/Mo</div><div class="rs-value">${t.churnPerMonth}</div></div>
                    </div>
                </div>
            `).join('')}

            <div class="card" style="margin-top:16px">
                <div class="card-header"><h3>💰 High-Margin Opportunities</h3></div>
                <div class="table-wrap"><table>
                    <tr><th>Account</th><th>Reason</th><th>Equipment Age</th><th>Repair Count</th></tr>
                    ${r.highMarginOpps.map(o => `
                        <tr><td><strong>${esc(o.account)}</strong></td><td>${esc(o.reason)}</td><td>${o.equipmentAge} yrs</td><td>${o.repairCount}</td></tr>
                    `).join('')}
                </table></div>
            </div>
        `;
    }

    // ========== WEEKLY REVIEW ==========
    function renderWeeklyReview() {
        const el = document.getElementById('page-weeklyreview');
        if (!reviewStart) reviewStart = new Date(weekStart()).toISOString().slice(0, 10);
        if (!reviewEnd) reviewEnd = new Date(weekEnd()).toISOString().slice(0, 10);

        const startMs = new Date(reviewStart).getTime();
        const endMs = new Date(reviewEnd).getTime() + 86400000;

        const weekLeads = leads.filter(l => l.createdAt >= startMs && l.createdAt <= endMs);
        const contactedSLA = weekLeads.filter(l => l.firstContactAt && (l.firstContactAt - l.createdAt) < 300000).length;
        const consultSched = weekLeads.filter(l => STAGES.indexOf(l.stage) >= STAGES.indexOf('Consultation Scheduled')).length;
        const propsSent = weekLeads.filter(l => STAGES.indexOf(l.stage) >= STAGES.indexOf('Proposal Sent')).length;
        const wonThisWeek = leads.filter(l => l.stage === 'Signed' && l.stageChangedAt >= startMs && l.stageChangedAt <= endMs);
        const lostThisWeek = leads.filter(l => l.stage === 'Lost' && l.stageChangedAt >= startMs && l.stageChangedAt <= endMs);
        const wonRev = wonThisWeek.reduce((s, l) => s + (l.quoteAmount || 0), 0);
        const cr = (wonThisWeek.length + lostThisWeek.length) > 0 ? wonThisWeek.length / (wonThisWeek.length + lostThisWeek.length) : 0;

        const totalForecast = leads.filter(l => l.stage !== 'Lost').reduce((s, l) => s + weightedValue(l), 0);

        // Source ROI
        const sourceRev = {};
        SOURCES.forEach(src => {
            sourceRev[src] = leads.filter(l => l.source === src && l.stage === 'Signed').reduce((s, l) => s + (l.quoteAmount || 0), 0);
        });
        const topSources = Object.entries(sourceRev).sort((a, b) => b[1] - a[1]).filter(([, v]) => v > 0);

        const stalled = stalledLeads();

        el.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px">
                <div class="date-range-picker">
                    <label style="font-weight:600;font-size:13px">Period:</label>
                    <input type="date" id="review-start" value="${reviewStart}" onchange="WF.setReviewRange()">
                    <span>to</span>
                    <input type="date" id="review-end" value="${reviewEnd}" onchange="WF.setReviewRange()">
                </div>
                <button class="btn btn-secondary" onclick="window.print()">🖨️ Print / Export</button>
            </div>

            <div class="kpi-grid">
                <div class="kpi-card blue"><div class="kpi-label">Leads Received</div><div class="kpi-value">${weekLeads.length}</div></div>
                <div class="kpi-card green"><div class="kpi-label">Contacted <5min</div><div class="kpi-value">${contactedSLA}</div></div>
                <div class="kpi-card blue"><div class="kpi-label">Consults Scheduled</div><div class="kpi-value">${consultSched}</div></div>
                <div class="kpi-card yellow"><div class="kpi-label">Proposals Sent</div><div class="kpi-value">${propsSent}</div></div>
                <div class="kpi-card green"><div class="kpi-label">Close Rate</div><div class="kpi-value">${pct(cr)}</div></div>
                <div class="kpi-card green"><div class="kpi-label">Revenue Won</div><div class="kpi-value">${fmt(wonRev)}</div></div>
            </div>

            <div class="grid-2">
                <div class="card review-section">
                    <h3>Forecast vs Target</h3>
                    <p style="font-size:24px;font-weight:800">${fmt(totalForecast)} <span style="font-size:14px;color:var(--gray-400)">/ ${fmt(monthlyTarget)}</span></p>
                    <div class="progress-bar-wrap" style="margin-top:8px"><div class="progress-bar-fill ${totalForecast >= monthlyTarget ? 'over' : ''}" style="width:${Math.min(totalForecast / monthlyTarget * 100, 100)}%"></div></div>
                </div>
                <div class="card review-section">
                    <h3>Top Sources by Revenue</h3>
                    ${topSources.length === 0 ? '<p style="color:var(--gray-400)">No signed revenue yet</p>' :
                topSources.map(([src, rev]) => `<div style="display:flex;justify-content:space-between;padding:4px 0"><span>${esc(src)}</span><strong>${fmt(rev)}</strong></div>`).join('')}
                </div>
            </div>

            <div class="card review-section">
                <h3>Stalled Deals</h3>
                ${stalled.length === 0 ? '<p style="color:var(--gray-400)">No stalled deals</p>' : `
                <div class="table-wrap"><table>
                    <tr><th>Lead</th><th>Stage</th><th>Days in Stage</th><th>Value</th><th>Salesperson</th></tr>
                    ${stalled.map(l => `<tr class="clickable" onclick="WF.viewLead('${l.id}')"><td>${esc(l.name)}</td><td><span class="badge ${stageClass(l.stage)}">${l.stage}</span></td><td class="${daysColor(daysInStage(l))}" style="font-weight:700">${daysInStage(l)}d</td><td>${fmt(l.quoteAmount)}</td><td>${esc(l.salesperson)}</td></tr>`).join('')}
                </table></div>`}
            </div>

            <div class="card review-section">
                <h3>Salesman Comparison</h3>
                <div class="table-wrap"><table>
                    <tr><th>Salesperson</th><th>Leads</th><th>Contacted %</th><th>Close Rate</th><th>Revenue</th><th>Avg Deal</th><th>Avg Response</th></tr>
                    ${SALESPEOPLE.map(sp => {
                const sLeads = leads.filter(l => l.salesperson === sp);
                const contacted = sLeads.filter(l => l.firstContactAt).length;
                const contactPct = sLeads.length > 0 ? contacted / sLeads.length : 0;
                const sWon = sLeads.filter(l => l.stage === 'Signed').length;
                const sLost = sLeads.filter(l => l.stage === 'Lost').length;
                const sCR = (sWon + sLost) > 0 ? sWon / (sWon + sLost) : 0;
                const sRev = sLeads.filter(l => l.stage === 'Signed').reduce((s, l) => s + (l.quoteAmount || 0), 0);
                const sAvg = sWon > 0 ? sRev / sWon : 0;
                const rts = sLeads.filter(l => l.firstContactAt).map(l => responseTimeMin(l)).filter(x => x !== null);
                const avgRT = rts.length > 0 ? rts.reduce((a, b) => a + b, 0) / rts.length : null;
                return `<tr>
                            <td><strong>${esc(sp)}</strong></td>
                            <td>${sLeads.length}</td>
                            <td class="${contactPct < 0.5 ? 'weakness' : ''}">${pct(contactPct)}</td>
                            <td class="${sCR < 0.2 && (sWon + sLost) > 0 ? 'weakness' : ''}">${pct(sCR)}</td>
                            <td>${fmt(sRev)}</td>
                            <td>${fmt(sAvg)}</td>
                            <td class="${avgRT !== null && avgRT > 30 ? 'weakness' : ''}">${avgRT !== null ? avgRT.toFixed(0) + 'm' : 'N/A'}</td>
                        </tr>`;
            }).join('')}
                </table></div>
            </div>
        `;
    }

    // ========== SALESMAN SCORECARD ==========
    function renderSalesmanScorecard() {
        const el = document.getElementById('page-salesman');
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        el.classList.add('active');
        document.getElementById('page-title').textContent = 'Salesman Scorecard';

        el.innerHTML = `
            <button class="btn btn-sm btn-secondary" onclick="WF.navigateTo('dashboard')" style="margin-bottom:16px">← Back to Dashboard</button>
            ${SALESPEOPLE.map(sp => {
                const sLeads = leads.filter(l => l.salesperson === sp);
                const contacted = sLeads.filter(l => l.firstContactAt).length;
                const contactPct = sLeads.length > 0 ? contacted / sLeads.length : 0;
                const sWon = sLeads.filter(l => l.stage === 'Signed').length;
                const sLost = sLeads.filter(l => l.stage === 'Lost').length;
                const sCR = (sWon + sLost) > 0 ? sWon / (sWon + sLost) : 0;
                const sRev = sLeads.filter(l => l.stage === 'Signed').reduce((s, l) => s + (l.quoteAmount || 0), 0);
                const sAvg = sWon > 0 ? sRev / sWon : 0;
                const pipeline = sLeads.filter(l => l.stage !== 'Signed' && l.stage !== 'Lost');
                const sStalled = pipeline.filter(l => daysInStage(l) > 14);
                const rts = sLeads.filter(l => l.firstContactAt).map(l => responseTimeMin(l)).filter(x => x !== null);
                const avgRT = rts.length > 0 ? rts.reduce((a, b) => a + b, 0) / rts.length : null;
                return `
                <div class="card">
                    <h3 style="margin-bottom:12px">👤 ${esc(sp)}</h3>
                    <div class="kpi-grid" style="margin-bottom:0">
                        <div class="kpi-card blue"><div class="kpi-label">Leads Assigned</div><div class="kpi-value">${sLeads.length}</div></div>
                        <div class="kpi-card ${contactPct < 0.5 ? 'red' : 'green'}"><div class="kpi-label">Contacted %</div><div class="kpi-value ${contactPct < 0.5 ? 'weakness' : ''}">${pct(contactPct)}</div></div>
                        <div class="kpi-card ${sCR < 0.2 && (sWon + sLost) > 0 ? 'red' : 'green'}"><div class="kpi-label">Close Rate</div><div class="kpi-value ${sCR < 0.2 && (sWon + sLost) > 0 ? 'weakness' : ''}">${pct(sCR)}</div></div>
                        <div class="kpi-card green"><div class="kpi-label">Revenue Closed</div><div class="kpi-value">${fmt(sRev)}</div></div>
                        <div class="kpi-card blue"><div class="kpi-label">Avg Deal Size</div><div class="kpi-value">${fmt(sAvg)}</div></div>
                        <div class="kpi-card ${avgRT !== null && avgRT > 30 ? 'red' : 'blue'}"><div class="kpi-label">Avg Response Time</div><div class="kpi-value ${avgRT !== null && avgRT > 30 ? 'weakness' : ''}">${avgRT !== null ? avgRT.toFixed(0) + 'm' : 'N/A'}</div></div>
                        <div class="kpi-card blue"><div class="kpi-label">Deals in Pipeline</div><div class="kpi-value">${pipeline.length}</div></div>
                        <div class="kpi-card ${sStalled.length > 0 ? 'red' : 'green'}"><div class="kpi-label">Stalled Deals</div><div class="kpi-value ${sStalled.length > 0 ? 'weakness' : ''}">${sStalled.length}</div></div>
                    </div>
                </div>`;
            }).join('')}
        `;
    }

    // ========== AUTOMATIONS PAGE ==========
    let automationsCache = [];
    let editingRule = null;

    function renderAutomations() {
        const el = document.getElementById('page-automations');
        el.innerHTML = `
            <div class="card">
                <div class="card-header"><h3>Automation Rules</h3><button class="btn btn-primary btn-sm" onclick="WF.addAutomation()">+ New Rule</button></div>
                <div id="auto-list"><p style="color:var(--gray-400);padding:12px">Loading...</p></div>
            </div>
            <div id="auto-editor" class="card hidden" style="margin-top:16px">
                <h3 id="auto-editor-title">Add Automation</h3>
                <form onsubmit="return WF.saveAutomation(event)" style="margin-top:12px">
                    <div class="form-row">
                        <div class="form-group"><label>Name</label><input class="form-control" id="ae-name" required></div>
                        <div class="form-group"><label>Enabled</label><select class="form-control" id="ae-enabled"><option value="true">Yes</option><option value="false">No</option></select></div>
                    </div>
                    <div class="form-row-3">
                        <div class="form-group"><label>Trigger Type</label>
                            <select class="form-control" id="ae-trigger-type" onchange="WF.toggleDuration()">
                                <option value="stage_change">Stage Change</option>
                                <option value="stage_enter">Stage Enter</option>
                                <option value="stage_duration">Stage Duration</option>
                                <option value="lead_created">Lead Created</option>
                                <option value="manual_flag">Manual Flag</option>
                            </select>
                        </div>
                        <div class="form-group"><label>Stage</label>
                            <select class="form-control" id="ae-stage">
                                <option value="any">Any</option>
                                ${STAGES.map(s => '<option value="' + s + '">' + s + '</option>').join('')}
                            </select>
                        </div>
                        <div class="form-group" id="ae-duration-group"><label>Duration (minutes)</label><input class="form-control" id="ae-duration" type="number" min="1"></div>
                    </div>
                    <div class="form-group"><label>From Stage (optional, for stage_change)</label>
                        <select class="form-control" id="ae-from-stage">
                            <option value="">Any</option>
                            ${STAGES.map(s => '<option value="' + s + '">' + s + '</option>').join('')}
                        </select>
                    </div>
                    <h4 style="margin:16px 0 8px">Conditions</h4>
                    <div id="ae-conditions"></div>
                    <button type="button" class="btn btn-sm btn-secondary" onclick="WF.addConditionRow()" style="margin-bottom:12px">+ Add Condition</button>
                    <h4 style="margin:16px 0 8px">Actions</h4>
                    <div id="ae-actions"></div>
                    <button type="button" class="btn btn-sm btn-secondary" onclick="WF.addActionRow()" style="margin-bottom:12px">+ Add Action</button>
                    <div class="template-help" style="background:var(--navy-light);padding:12px;border-radius:8px;margin:12px 0;font-size:12px;color:var(--gray-300)">
                        <strong>Template variables:</strong> {{lead.name}}, {{lead.stage}}, {{lead.quoteAmount}}, {{lead.salesperson}}, {{lead.jobType}}, {{lead.phone}}, {{lead.email}}, {{lead.nextAction}}, {{lead.source}}, {{lead.lossReason}}, {{lead.salesperson_phone}}, {{lead.salesperson_email}}, {{lead.createdAgo}}
                    </div>
                    <div style="display:flex;gap:8px;margin-top:12px">
                        <button type="submit" class="btn btn-primary">Save Rule</button>
                        <button type="button" class="btn btn-secondary" onclick="WF.cancelAutoEdit()">Cancel</button>
                        <button type="button" class="btn btn-sm btn-blue" onclick="WF.testAutomation()" style="margin-left:auto">🧪 Test</button>
                    </div>
                </form>
            </div>
        `;
        fetchAutomations();
    }

    function fetchAutomations() {
        const url = getApiUrl();
        fetch(url + '/api/automations', { headers: authHeaders() }).then(r => r.json()).then(rules => {
            automationsCache = rules;
            renderAutoList(rules);
        }).catch(() => {
            document.getElementById('auto-list').innerHTML = '<p style="color:var(--red);padding:12px">⚠️ Could not connect to backend at ' + esc(url) + '. Make sure the server is running.</p>';
        });
    }

    function renderAutoList(rules) {
        const list = document.getElementById('auto-list');
        if (!rules.length) { list.innerHTML = '<p style="color:var(--gray-400);padding:12px">No automation rules yet.</p>'; return; }
        list.innerHTML = `<div class="table-wrap"><table>
            <thead><tr><th>Name</th><th>Trigger</th><th>Stage</th><th>Actions</th><th>Enabled</th><th></th></tr></thead>
            <tbody>${rules.map(r => {
                const trigLabel = r.trigger?.type || '—';
                const stageLabel = r.trigger?.stage || '—';
                const dur = r.trigger?.durationMinutes ? ' (' + r.trigger.durationMinutes + ' min)' : '';
                const actCount = (r.actions || []).length;
                return `<tr>
                    <td><strong>${esc(r.name)}</strong></td>
                    <td>${esc(trigLabel)}${dur}</td>
                    <td>${esc(stageLabel)}</td>
                    <td>${actCount} action${actCount !== 1 ? 's' : ''}</td>
                    <td><label class="toggle-switch"><input type="checkbox" ${r.enabled ? 'checked' : ''} onchange="WF.toggleAutoEnabled('${r.id}',this.checked)"><span class="toggle-slider"></span></label></td>
                    <td style="white-space:nowrap">
                        <button class="btn btn-sm btn-secondary" onclick="WF.editAutomation('${r.id}')">Edit</button>
                        <button class="btn btn-sm btn-danger" onclick="WF.deleteAutomation('${r.id}')">Delete</button>
                    </td>
                </tr>`;
            }).join('')}</tbody>
        </table></div>`;
    }

    function addAutomation() {
        editingRule = null;
        document.getElementById('auto-editor').classList.remove('hidden');
        document.getElementById('auto-editor-title').textContent = 'Add Automation';
        document.getElementById('ae-name').value = '';
        document.getElementById('ae-enabled').value = 'true';
        document.getElementById('ae-trigger-type').value = 'stage_change';
        document.getElementById('ae-stage').value = 'any';
        document.getElementById('ae-from-stage').value = '';
        document.getElementById('ae-duration').value = '';
        document.getElementById('ae-conditions').innerHTML = '';
        document.getElementById('ae-actions').innerHTML = '';
        toggleDuration();
        addActionRow();
    }

    function editAutomation(id) {
        const rule = automationsCache.find(r => r.id === id);
        if (!rule) return;
        editingRule = rule;
        document.getElementById('auto-editor').classList.remove('hidden');
        document.getElementById('auto-editor-title').textContent = 'Edit: ' + rule.name;
        document.getElementById('ae-name').value = rule.name || '';
        document.getElementById('ae-enabled').value = String(rule.enabled !== false);
        document.getElementById('ae-trigger-type').value = rule.trigger?.type || 'stage_change';
        document.getElementById('ae-stage').value = rule.trigger?.stage || 'any';
        document.getElementById('ae-from-stage').value = rule.trigger?.fromStage || '';
        document.getElementById('ae-duration').value = rule.trigger?.durationMinutes || '';
        toggleDuration();
        // Conditions
        document.getElementById('ae-conditions').innerHTML = '';
        (rule.conditions || []).forEach(c => addConditionRow(c));
        // Actions
        document.getElementById('ae-actions').innerHTML = '';
        (rule.actions || []).forEach(a => addActionRow(a));
        if ((rule.actions || []).length === 0) addActionRow();
    }

    function cancelAutoEdit() {
        document.getElementById('auto-editor').classList.add('hidden');
        editingRule = null;
    }

    function toggleDuration() {
        const t = document.getElementById('ae-trigger-type').value;
        document.getElementById('ae-duration-group').style.display = t === 'stage_duration' ? '' : 'none';
    }

    function addConditionRow(cond) {
        const div = document.getElementById('ae-conditions');
        const row = document.createElement('div');
        row.className = 'form-row cond-row';
        row.style.marginBottom = '8px';
        row.innerHTML = `
            <select class="form-control cond-field"><option value="jobType" ${cond?.field === 'jobType' ? 'selected' : ''}>Job Type</option><option value="salesperson" ${cond?.field === 'salesperson' ? 'selected' : ''}>Salesperson</option><option value="quoteAmount" ${cond?.field === 'quoteAmount' ? 'selected' : ''}>Quote Amount</option><option value="source" ${cond?.field === 'source' ? 'selected' : ''}>Source</option></select>
            <select class="form-control cond-op"><option value="equals" ${cond?.operator === 'equals' ? 'selected' : ''}>equals</option><option value="notEquals" ${cond?.operator === 'notEquals' ? 'selected' : ''}>not equals</option><option value="greaterThan" ${cond?.operator === 'greaterThan' ? 'selected' : ''}>greater than</option><option value="lessThan" ${cond?.operator === 'lessThan' ? 'selected' : ''}>less than</option><option value="contains" ${cond?.operator === 'contains' ? 'selected' : ''}>contains</option></select>
            <input class="form-control cond-val" placeholder="Value" value="${esc(cond?.value || '')}">
            <button type="button" class="btn btn-sm btn-danger" onclick="this.parentElement.remove()">✕</button>
        `;
        div.appendChild(row);
    }

    function addActionRow(action) {
        const div = document.getElementById('ae-actions');
        const row = document.createElement('div');
        row.className = 'action-row';
        row.style.marginBottom = '12px';
        row.style.padding = '12px';
        row.style.background = 'var(--navy-lighter)';
        row.style.borderRadius = '8px';
        const isSMS = !action || action.type === 'sms';
        row.innerHTML = `
            <div class="form-row" style="margin-bottom:8px">
                <div class="form-group"><label>Type</label><select class="form-control act-type" onchange="WF.toggleActionFields(this)"><option value="sms" ${isSMS ? 'selected' : ''}>SMS</option><option value="email" ${!isSMS ? 'selected' : ''}>Email</option></select></div>
                <div class="form-group"><label>To</label><input class="form-control act-to" placeholder="Phone/email or {{lead.salesperson_phone}}" value="${esc(action?.to || '')}"></div>
                <div style="padding-top:24px"><button type="button" class="btn btn-sm btn-danger" onclick="this.closest('.action-row').remove()">✕</button></div>
            </div>
            <div class="act-sms-fields" style="${isSMS ? '' : 'display:none'}">
                <div class="form-group"><label>Message</label><textarea class="form-control act-message" rows="2" placeholder="SMS message with {{lead.name}} etc.">${esc(action?.message || '')}</textarea></div>
            </div>
            <div class="act-email-fields" style="${!isSMS ? '' : 'display:none'}">
                <div class="form-group"><label>Subject</label><input class="form-control act-subject" value="${esc(action?.subject || '')}"></div>
                <div class="form-group"><label>Body</label><textarea class="form-control act-body" rows="3">${esc(action?.body || '')}</textarea></div>
            </div>
        `;
        div.appendChild(row);
    }

    function toggleActionFields(sel) {
        const row = sel.closest('.action-row');
        const isSMS = sel.value === 'sms';
        row.querySelector('.act-sms-fields').style.display = isSMS ? '' : 'none';
        row.querySelector('.act-email-fields').style.display = isSMS ? 'none' : '';
    }

    function saveAutomation(e) {
        e.preventDefault();
        const rule = {
            id: editingRule ? editingRule.id : '',
            name: document.getElementById('ae-name').value.trim(),
            enabled: document.getElementById('ae-enabled').value === 'true',
            trigger: {
                type: document.getElementById('ae-trigger-type').value,
                stage: document.getElementById('ae-stage').value
            },
            conditions: [],
            actions: []
        };
        const fromStage = document.getElementById('ae-from-stage').value;
        if (fromStage) rule.trigger.fromStage = fromStage;
        const dur = document.getElementById('ae-duration').value;
        if (dur && rule.trigger.type === 'stage_duration') rule.trigger.durationMinutes = parseInt(dur);
        // Conditions
        document.querySelectorAll('.cond-row').forEach(row => {
            rule.conditions.push({
                field: row.querySelector('.cond-field').value,
                operator: row.querySelector('.cond-op').value,
                value: row.querySelector('.cond-val').value
            });
        });
        // Actions
        document.querySelectorAll('.action-row').forEach(row => {
            const type = row.querySelector('.act-type').value;
            const to = row.querySelector('.act-to').value;
            if (type === 'sms') {
                rule.actions.push({ type, to, message: row.querySelector('.act-message').value });
            } else {
                rule.actions.push({ type, to, subject: row.querySelector('.act-subject').value, body: row.querySelector('.act-body').value });
            }
        });
        const url = getApiUrl();
        fetch(url + '/api/automations', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify(rule)
        }).then(r => r.json()).then(() => {
            cancelAutoEdit();
            fetchAutomations();
        }).catch(err => alert('Error saving: ' + err.message));
        return false;
    }

    function deleteAutomation(id) {
        if (!confirm('Delete this automation rule?')) return;
        const url = getApiUrl();
        fetch(url + '/api/automations/' + id, { method: 'DELETE', headers: authHeaders() }).then(() => fetchAutomations()).catch(err => alert('Error: ' + err.message));
    }

    function toggleAutoEnabled(id, enabled) {
        const rule = automationsCache.find(r => r.id === id);
        if (!rule) return;
        rule.enabled = enabled;
        const url = getApiUrl();
        fetch(url + '/api/automations', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify(rule)
        }).then(() => fetchAutomations()).catch(err => alert('Error: ' + err.message));
    }

    function testAutomation() {
        const testLead = leads[0] || { id: 'TEST', name: 'Test Lead', stage: 'New', jobType: 'New Pool', salesperson: 'Ricardo', quoteAmount: 50000, source: 'Google Ads', phone: '210-555-0000', email: 'test@test.com', nextAction: 'Call back' };
        const url = getApiUrl();
        fetch(url + '/api/notify', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ type: 'sms', to: '+12105598725', message: '🧪 WortheyFlow test notification. Lead: ' + testLead.name })
        }).then(r => r.json()).then(d => {
            alert(d.dry ? 'Test sent (DRY RUN — no API keys configured). Check server console.' : 'Test notification sent!');
        }).catch(err => alert('Could not reach server: ' + err.message));
    }

    // ========== SETTINGS ==========
    const defaultContacts = [
        { name: 'Ricardo', email: '', phone: '' },
        { name: 'Anibal', email: '', phone: '' },
        { name: 'Richard', email: '', phone: '' }
    ];

    function renderSettings() {
        const el = document.getElementById('page-settings');
        const notifSettings = JSON.parse(localStorage.getItem('wf_notif_settings') || '{}');
        if (!notifSettings.contactDirectory) notifSettings.contactDirectory = defaultContacts;

        // Change password section (all roles)
        let html = `
            <div class="card change-pw-card">
                <h3 style="margin-bottom:16px">Change Password</h3>
                <div class="form-group"><label>Current Password</label><input class="form-control" id="cp-current" type="password"></div>
                <div class="form-group"><label>New Password</label><input class="form-control" id="cp-new" type="password"></div>
                <div class="form-group"><label>Confirm New Password</label><input class="form-control" id="cp-confirm" type="password"></div>
                <div id="cp-msg" style="margin-bottom:8px"></div>
                <button class="btn btn-primary" onclick="WF.changePassword()">Update Password</button>
            </div>
        `;

        if (!isAdmin()) {
            // Non-admin: only automations link + change password
            el.innerHTML = html;
            return;
        }

        html += `
            <div class="card" style="max-width:700px;margin-top:16px">
                <h3 style="margin-bottom:20px">Probability Tables</h3>
                <p style="color:var(--gray-500);font-size:13px;margin-bottom:16px">Edit weighted probabilities (%) for forecast calculations. Changes auto-save.</p>

                <div class="prob-table">
                    <h4>🏗️ Construction (New Pool, Remodel, Commercial)</h4>
                    ${STAGES.map(s => `
                        <div class="prob-row">
                            <label>${s}</label>
                            <input type="number" min="0" max="100" value="${probabilities.construction[s] || 0}" onchange="WF.updateProb('construction','${s}',this.value)">
                            <span>%</span>
                        </div>
                    `).join('')}
                </div>

                <div class="prob-table">
                    <h4>🔧 Service / Equipment (Equipment Repair, Service Route)</h4>
                    ${STAGES.map(s => `
                        <div class="prob-row">
                            <label>${s}</label>
                            <input type="number" min="0" max="100" value="${probabilities.service[s] || 0}" onchange="WF.updateProb('service','${s}',this.value)">
                            <span>%</span>
                        </div>
                    `).join('')}
                </div>

                <button class="btn btn-secondary" onclick="WF.resetProbs()">Reset to Defaults</button>
            </div>

            <div class="card" style="max-width:700px;margin-top:16px">
                <h3 style="margin-bottom:16px">Monthly Target</h3>
                <div class="form-group">
                    <label>Revenue Target ($)</label>
                    <input class="form-control" type="number" value="${monthlyTarget}" min="0" step="10000" style="max-width:200px" onchange="WF.updateTarget(this.value)">
                </div>
            </div>

            <div class="card" style="max-width:700px;margin-top:16px">
                <h3 style="margin-bottom:16px">Notification Settings</h3>
                <div class="form-group">
                    <label>API URL</label>
                    <input class="form-control" id="ns-api-url" value="${esc(notifSettings.apiUrl || 'https://pat-furniture-developing-bass.trycloudflare.com')}" style="max-width:400px" placeholder="http://localhost:3001">
                    <small style="color:var(--gray-500)">Backend server URL for automations & notifications</small>
                </div>
                <h4 style="margin:16px 0 8px">Contact Directory</h4>
                <div id="contact-dir-rows">
                ${(notifSettings.contactDirectory || defaultContacts).map((c, i) => `
                    <div class="form-row contact-row" style="margin-bottom:4px;align-items:flex-end">
                        <div class="form-group"><label>${i === 0 ? 'Name' : ''}</label><input class="form-control ns-name" value="${esc(c.name)}"></div>
                        <div class="form-group"><label>${i === 0 ? 'Email' : ''}</label><input class="form-control ns-email" value="${esc(c.email)}" placeholder="email@example.com"></div>
                        <div class="form-group"><label>${i === 0 ? 'Phone' : ''}</label><input class="form-control ns-phone" value="${esc(c.phone)}" placeholder="+1XXXXXXXXXX"></div>
                        <div class="form-group" style="flex:0 0 auto"><button class="btn btn-sm btn-danger" onclick="this.closest('.contact-row').remove()" style="margin-bottom:0">✕</button></div>
                    </div>
                `).join('')}
                </div>
                <button class="btn btn-sm btn-secondary" onclick="WF.addContactRow()" style="margin-top:4px">+ Add Contact</button>
                <div style="margin-top:12px">
                    <button class="btn btn-primary" onclick="WF.saveNotifSettings()">Save Notification Settings</button>
                </div>
            </div>

            <div class="card" style="max-width:700px;margin-top:16px">
                <h3 style="margin-bottom:16px">Data Management</h3>
                <div style="display:flex;gap:8px;flex-wrap:wrap">
                    <button class="btn btn-danger" onclick="if(confirm('Reset ALL data to defaults?')){localStorage.clear();location.reload()}">Reset All Data</button>
                    <button class="btn btn-secondary" onclick="WF.exportData()">Export JSON</button>
                    <button class="btn btn-secondary" onclick="document.getElementById('import-file').click()">Import JSON</button>
                    <input type="file" id="import-file" accept=".json" style="display:none" onchange="WF.importData(this)">
                </div>
            </div>
        `;
        el.innerHTML = html;
    }

    function changePassword() {
        const curr = document.getElementById('cp-current').value;
        const newPw = document.getElementById('cp-new').value;
        const confirm = document.getElementById('cp-confirm').value;
        const msgEl = document.getElementById('cp-msg');
        if (newPw !== confirm) { msgEl.innerHTML = '<span style="color:#ef4444">Passwords do not match.</span>'; return; }
        if (newPw.length < 4) { msgEl.innerHTML = '<span style="color:#ef4444">Password must be at least 4 characters.</span>'; return; }
        const url = getApiUrl();
        fetch(url + '/api/auth/change-password', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ currentPassword: curr, newPassword: newPw })
        }).then(r => r.json()).then(d => {
            if (d.error) { msgEl.innerHTML = '<span style="color:#ef4444">' + esc(d.error) + '</span>'; return; }
            msgEl.innerHTML = '<span style="color:#10b981">Password updated successfully!</span>';
            document.getElementById('cp-current').value = '';
            document.getElementById('cp-new').value = '';
            document.getElementById('cp-confirm').value = '';
        }).catch(err => { msgEl.innerHTML = '<span style="color:#ef4444">Server error.</span>'; });
    }

    function addContactRow() {
        const container = document.getElementById('contact-dir-rows');
        const row = document.createElement('div');
        row.className = 'form-row contact-row';
        row.style = 'margin-bottom:4px;align-items:flex-end';
        row.innerHTML = `
            <div class="form-group"><input class="form-control ns-name" placeholder="Name"></div>
            <div class="form-group"><input class="form-control ns-email" placeholder="email@example.com"></div>
            <div class="form-group"><input class="form-control ns-phone" placeholder="+1XXXXXXXXXX"></div>
            <div class="form-group" style="flex:0 0 auto"><button class="btn btn-sm btn-danger" onclick="this.closest('.contact-row').remove()" style="margin-bottom:0">✕</button></div>
        `;
        container.appendChild(row);
    }

    function saveNotifSettings() {
        const apiUrl = document.getElementById('ns-api-url').value.trim();
        const names = document.querySelectorAll('.ns-name');
        const emails = document.querySelectorAll('.ns-email');
        const phones = document.querySelectorAll('.ns-phone');
        const contactDirectory = [];
        names.forEach((n, i) => {
            contactDirectory.push({ name: n.value.trim(), email: emails[i].value.trim(), phone: phones[i].value.trim() });
        });
        localStorage.setItem('wf_notif_settings', JSON.stringify({ apiUrl, contactDirectory }));
        alert('Notification settings saved.');
    }

    function updateProb(cat, stage, val) {
        probabilities[cat][stage] = parseInt(val) || 0;
        saveProbs();
    }

    function resetProbs() {
        probabilities = JSON.parse(JSON.stringify(DEFAULT_PROBS));
        saveProbs();
        renderSettings();
    }

    function updateTarget(val) {
        monthlyTarget = parseInt(val) || 0;
        saveTarget();
    }

    function exportData() {
        const data = { leads, probabilities, monthlyTarget, serviceRouteData, version: '2.1' };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'wortheyflow-backup-' + today() + '.json';
        a.click();
    }

    function importData(input) {
        const file = input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = e => {
            try {
                const data = JSON.parse(e.target.result);
                if (data.leads) { leads = data.leads; saveLeads(); }
                if (data.probabilities) { probabilities = data.probabilities; saveProbs(); }
                if (data.monthlyTarget) { monthlyTarget = data.monthlyTarget; saveTarget(); }
                if (data.serviceRouteData) { serviceRouteData = data.serviceRouteData; saveRoutes(); }
                alert('Data imported successfully.');
                location.reload();
            } catch (err) {
                alert('Error importing: ' + err.message);
            }
        };
        reader.readAsText(file);
    }

    // ========== REVIEW DATE RANGE ==========
    function setReviewRange() {
        reviewStart = document.getElementById('review-start').value;
        reviewEnd = document.getElementById('review-end').value;
        renderWeeklyReview();
    }

    // ========== FILTER ==========
    function setFilter(f) {
        currentFilter = f;
        renderInbox();
    }

    // ========== VIEW LEAD ==========
    function viewLead(id) {
        currentLeadId = id;
        document.getElementById('notification-panel').classList.add('hidden');
        navigateTo('leaddetail', id);
    }

    // ========== REASSIGN ==========
    function reassign(id) {
        const lead = leads.find(l => l.id === id);
        if (!lead) return;
        const newSP = prompt('Reassign "' + lead.name + '" to which salesperson?\n\n' + SALESPEOPLE.join('\n'), lead.salesperson);
        if (newSP && SALESPEOPLE.includes(newSP)) {
            lead.salesperson = newSP;
            saveLeads();
            generateNotifications();
            updateBellBadge();
            renderNotifications();
            alert('Reassigned to ' + newSP);
        }
    }

    // ========== PUBLIC API ==========
    window.WF = {
        navigateTo, viewLead, setFilter, submitLead, updateLead, quickNote, deleteLead,
        updateProb, resetProbs, updateTarget, exportData, importData,
        setReviewRange, reassign, saveNotifSettings, addContactRow,
        addAutomation, editAutomation, cancelAutoEdit, saveAutomation, deleteAutomation,
        toggleAutoEnabled, testAutomation, addConditionRow, addActionRow, toggleActionFields,
        toggleDuration, logout, changePassword
    };

    // ========== BOOT ==========
    document.addEventListener('DOMContentLoaded', init);
})();
