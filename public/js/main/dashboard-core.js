// --- GLOBAL VARIABLES & AUTH ---
console.info('🚀 [CORE] dashboard-core.js loaded and initializing...');

const handlePaymentResponse = () => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('success') === 'true') {
        console.log('💳 [CORE] Payment success detected in URL. Cleaning URL and fetching fresh data...');
        window.history.replaceState({}, document.title, "/dashboard.html");
        alert("🎉 Payment Success! Updating your secure storage...");
        fetchMasterData();
    }
};

handlePaymentResponse();
const token = localStorage.getItem('token');
if (!token) {
    console.warn('⚠️ [CORE] No auth token found. Redirecting to login...');
    window.location.href = 'login.html';
} else {
    console.log('✅ [CORE] Auth token found.');
}

const authHeaders = { 'x-auth-token': token, 'Content-Type': 'application/json' };
let currentWorkspaceId = null;

window.onload = () => {
    console.log('🌐 [CORE] Window loaded. Triggering initial data fetch...');
    fetchMasterData();
};

// --- CORE DATA FETCHING ---
async function fetchMasterData() {
    console.log('🔄 [CORE] Fetching master data from /api/subscription/status...');
    try {
        const res = await fetch('http://127.0.0.1:5000/api/subscription/status', {
            headers: { 'x-auth-token': token }
        });

        const data = await res.json();
        console.log('✅ [CORE] Master data received successfully:', data);

        document.getElementById('topbar-email').innerText = data.userEmail;
        document.getElementById('topbar-avatar').innerText = data.username.charAt(0).toUpperCase();

        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('success') === 'true') {
            window.history.replaceState({}, document.title, window.location.pathname);
            alert(`🎉 Success! Your account has been upgraded to ${data.package}.`);
        }

        console.log('🎨 [CORE] Triggering UI renders...');
        renderPersonalData(data);
        renderWorkspaceHub(data);
        renderBilling(data);
        renderActivityFeed(data.activityFeed);

        loadFiles('personal', 'fileListPersonal');

    } catch (err) {
        console.error("💥 [CORE] Critical Master Data Fetch Error:", err);
    }
}

async function loadUserStatus() {
    console.log('🔄 [CORE] loadUserStatus triggered...');
    const token = localStorage.getItem('token');
    if (!token) {
        console.warn('⚠️ [CORE] No token in loadUserStatus, redirecting...');
        window.location.href = 'login.html';
        return;
    }
    try {
        const res = await fetch('/api/subscription/status', {
            headers: { 'x-auth-token': token }
        });
        const data = await res.json();
        document.getElementById('plan-name').innerText = data.package;
        document.getElementById('storage-limit').innerText = `${(data.limit / 1024 / 1024).toFixed(0)} MB`;
        const percent = (data.used / data.limit) * 100;
        document.getElementById('storage-bar').style.width = `${percent}%`;
        console.log('✅ [CORE] loadUserStatus complete.');
    } catch (err) {
        console.error("💥 [CORE] Failed to load user status:", err);
    }
}

// --- UI NAVIGATION ---
function switchTab(tabId) {
    console.log(`🔀 [CORE] Switching tab view to: ${tabId}`);
    document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
    document.getElementById(`${tabId}-view`).classList.add('active');
    document.getElementById(`nav-${tabId}`)?.classList.add('active');
    document.getElementById('topbar-title').innerText = tabId === 'personal' ? 'My Personal Drive' : 'Team Workspaces';
}

function openWorkspace(id, displayName, isOwner) {
    console.log(`📂 [CORE] Opening workspace ID: ${id} | Owner: ${isOwner}`);
    currentWorkspaceId = id;
    document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
    document.getElementById('explorer-view').classList.add('active');

    const badge = document.getElementById('workspaceOwnerBadge');
    const deleteBtn = document.getElementById('deleteWorkspaceBtn');
    const leaveBtn = document.getElementById('leaveWorkspaceBtn');

    if (!isOwner) {
        badge.innerHTML = `<i class="fa-solid fa-user-group"></i> Shared from: ${displayName}`;
        deleteBtn.style.display = 'none';
        leaveBtn.style.display = 'inline-flex';
    } else {
        badge.innerHTML = `<i class="fa-solid fa-crown"></i> Owned by: Me (${displayName})`;
        deleteBtn.style.display = 'inline-flex';
        leaveBtn.style.display = 'none';
    }

    document.getElementById('fileListWorkspace').innerHTML = '<tr><td colspan="4" style="text-align:center;"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</td></tr>';
    loadFiles(id, 'fileListWorkspace');
}

function closeWorkspaceModal() {
    console.log('🚪 [CORE] Closing workspace modal.');
    document.getElementById('createWorkspaceModal').style.display = 'none';
}

function logout() {
    console.log('👋 [CORE] Logging out. Clearing token and redirecting...');
    localStorage.removeItem('token');
    window.location.href = 'login.html';
}

// --- RENDER FUNCTIONS (Keeping logs light here to avoid console spam) ---
function renderBilling(data) { /* Content remains exactly the same */
    const subStatus = document.getElementById('subStatus');
    const dateStatus = document.getElementById('dateStatus');
    const upgradePremiumBtn = document.querySelector('button[onclick*="Premium"]');
    const upgradeEnterpriseBtn = document.querySelector('button[onclick*="Enterprise"]');

    if (!subStatus) return;

    let totalLimit = data.package === 'Enterprise' ? '500 GB' : (data.package === 'Premium' ? '100 GB' : '50 MB');

    subStatus.innerHTML = ` 
        <div style="font-size: 0.85rem; text-transform: uppercase; color: var(--text-muted); margin-bottom: 5px;">Current Plan</div> 
        <div style="font-size: 1.5rem; font-weight: 700; color: var(--workspace);">${data.package}</div> 
        <div style="font-size: 0.9rem; margin-top: 5px; color: var(--text-main);">Total Allowance: <strong>${totalLimit}</strong></div>`;

    if (data.package === 'Basic') {
        dateStatus.innerHTML = `<i class="fa-solid fa-infinity"></i> Lifetime Free Basic Tier`;
    } else if (data.subscriptionEnd) {
        const expiryDate = new Date(data.subscriptionEnd).toLocaleDateString('en-MY', { year: 'numeric', month: 'long', day: 'numeric' });
        dateStatus.innerHTML = `<i class="fa-solid fa-calendar-check" style="color:var(--success)"></i> Next Renewal: <strong>${expiryDate}</strong>`;
    } else {
        dateStatus.innerHTML = `<i class="fa-solid fa-star" style="color:var(--warning)"></i> Active Subscription`;
    }

    if (data.package === 'Enterprise') {
        upgradePremiumBtn.style.display = 'none';
        upgradeEnterpriseBtn.style.display = 'none';
    } else if (data.package === 'Premium') {
        upgradePremiumBtn.style.display = 'none';
        upgradeEnterpriseBtn.style.display = 'inline-flex';
    } else {
        upgradePremiumBtn.style.display = 'inline-flex';
        upgradeEnterpriseBtn.style.display = 'inline-flex';
    }
}
function renderWorkspaceHub(data) { /* Content remains exactly the same */
    const grid = document.getElementById('wsJoinedGrid');
    const dropdown = document.getElementById('inviteWorkspaceSelect');
    const shareInput = document.getElementById('shareEmailInput');
    const inviteBtn = document.querySelector('button[onclick="shareStorage()"]');
    const shareText = document.getElementById('shareLimitText');
    const inboxArea = document.getElementById('wsInboxArea');
    const inboxList = document.getElementById('wsInboxList');

    if (data.inbox && data.inbox.length > 0) {
        inboxArea.style.display = 'block';
        inboxList.innerHTML = data.inbox.map(inv => `
    <div class="invite-card">
        <div><strong>${inv.inviter.username}</strong> invited you to join <strong>${inv.workspaceName}</strong></div>
        <div style="display: flex; gap: 8px;">
            <button class="btn btn-primary" style="width:auto; padding: 5px 15px;" onclick="acceptInvite('${inv._id}')">Accept</button>
            <button class="btn btn-outline" style="width:auto; padding: 5px 15px; color: var(--danger); border-color: var(--danger);" onclick="rejectInvite('${inv._id}')">Reject</button>
        </div>
    </div>`).join('');
    } else {
        inboxArea.style.display = 'none';
    }

    let html = '';
    if (data.workspacesCreated) {
        html += data.workspacesCreated.map(ws => `
    <div class="ws-card" onclick="openWorkspace('${ws._id}', '${ws.name}', true)">
        <div class="ws-icon" style="background:#eef2ff;"><i class="fa-solid fa-briefcase"></i></div>
        <div><h4>${ws.name}</h4><span style="color:var(--primary); font-weight:600;">Owner</span></div>
    </div>`).join('');
    }
    if (data.workspaces) {
        html += data.workspaces.map(ws => `
    <div class="ws-card" onclick="openWorkspace('${ws._id}', '${ws.username}', false)">
        <div class="ws-icon"><i class="fa-solid fa-folder-tree"></i></div>
        <div><h4>${ws.name}</h4><span>Shared from ${ws.username}</span></div>
    </div>`).join('');
    }
    grid.innerHTML = html || '<div style="grid-column: 1/-1; color: var(--text-muted);">No workspaces yet.</div>';

    if (data.workspacesCreated && data.workspacesCreated.length > 0) {
        dropdown.innerHTML = '<option value="">-- Choose a workspace --</option>' +
            data.workspacesCreated.map(ws => `<option value="${ws._id}">${ws.name}</option>`).join('');
        dropdown.disabled = false;
    } else {
        dropdown.innerHTML = '<option value="">Create a workspace first</option>';
        dropdown.disabled = true;
    }

    if (data.package === 'Basic') {
        shareText.innerText = "Basic Plan cannot share storage.";
        dropdown.disabled = true;
        shareInput.disabled = true;
        inviteBtn.disabled = true;
        inviteBtn.style.opacity = "0.5";
    } else {
        shareText.innerHTML = `<i class="fa-solid fa-check-circle" style="color:var(--success)"></i> ${data.package} Plan: Targeted sharing enabled.`;
        shareInput.disabled = false;
        inviteBtn.disabled = false;
        inviteBtn.style.opacity = "1";
    }

    const sentList = document.getElementById('sentInvitesList');
    if (sentList) {
        if (data.pendingSentInvites && data.pendingSentInvites.length > 0) {
            sentList.innerHTML = data.pendingSentInvites.map(inv => {
                const ws = data.workspacesCreated.find(w => w._id.toString() === inv.workspaceId.toString());
                return `
            <tr>
                <td><i class="fa-solid fa-envelope"></i> ${inv.inviteeEmail}</td>
                <td><i class="fa-solid fa-folder-tree"></i> ${ws ? ws.name : 'Shared Workspace'}</td>
                <td><span class="badge" style="background:var(--warning); color:white;">Pending</span></td>
                <td style="text-align:right;">
                    <button class="action-btn" style="background:var(--danger); padding: 5px 12px; font-size:0.75rem; border-radius:4px;" 
                        onclick="revokeInvite('${inv._id}')">
                        <i class="fa-solid fa-trash-can"></i> Revoke
                    </button>
                </td>
            </tr>`;
            }).join('');
        } else {
            sentList.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px; color:var(--text-muted);">No pending invitations sent.</td></tr>';
        }
    }
}
function renderPersonalData(data) { /* Content remains exactly the same */
    const usedMB = (data.used / (1024 * 1024)).toFixed(2);
    const allocatedBytes = data.workspacesCreated.reduce((acc, ws) => acc + ws.allocatedBytes, 0);
    const allocatedGB = (allocatedBytes / (1024 * 1024 * 1024)).toFixed(2);
    let totalLimitText = data.package === 'Enterprise' ? '500 GB' : (data.package === 'Premium' ? '100 GB' : '50 MB');

    document.getElementById('personalStorageText').innerHTML =
        `Used: <strong>${usedMB} MB</strong> | Allocated: <strong>${allocatedGB} GB</strong> / ${totalLimitText}`;

    const percent = Math.min((allocatedBytes / data.limit) * 100, 100);
    document.getElementById('personalStorageBar').style.width = percent + '%';
    document.getElementById('personalStorageBar').style.background = percent > 90 ? 'var(--danger)' : 'var(--primary)';
}
function renderActivityFeed(activities) { /* Content remains exactly the same */
    const feed = document.getElementById('activityFeed');
    const userEmail = document.getElementById('topbar-email').innerText;

    if (!activities || activities.length === 0) {
        feed.innerHTML = '<p style="padding: 20px; text-align: center; color: var(--text-muted);">No recent activity.</p>';
        return;
    }

    feed.innerHTML = activities.map(act => {
        let icon = 'fa-circle-info';
        let actionText = '';
        let iconColor = 'var(--primary)';
        let showUser = true;

        if (act.type === 'WORKSPACE_CREATED') { icon = 'fa-folder-plus'; actionText = `created workspace <strong>${act.name || act.details}</strong>`; }
        else if (act.type === 'WORKSPACE_DELETED') { icon = 'fa-trash-can'; iconColor = 'var(--danger)'; actionText = `deleted workspace <strong>${act.name || act.details}</strong>`; }
        else if (act.type === 'LEAVE_WORKSPACE') { icon = 'fa-person-walking-arrow-right'; iconColor = 'var(--warning)'; actionText = `left workspace <strong>${act.name || act.details}</strong>`; }
        else if (act.type === 'FILE_UPLOADED') { icon = 'fa-file-arrow-up'; iconColor = 'var(--primary)'; actionText = `<strong>${act.details || 'uploaded a file'}</strong>`; }
        else if (act.type === 'FILE_DELETED') { icon = 'fa-file-circle-xmark'; iconColor = 'var(--danger)'; actionText = `<strong>${act.details || 'deleted a file'}</strong>`; }
        else if (act.type === 'PAYMENT_SUCCESS') { icon = 'fa-credit-card'; iconColor = 'var(--success)'; actionText = `<strong>${act.details || 'Plan Upgraded Successfully'}</strong>`; showUser = false; }
        else if (act.type === 'INVITE_SENT') { icon = 'fa-paper-plane'; actionText = `sent invite to <strong>${act.name || act.details}</strong>`; }
        else if (act.type === 'INVITE_ACCEPTED') { icon = 'fa-check-double'; iconColor = 'var(--success)'; actionText = `<strong>${act.name || act.details || 'via invitation'}</strong>`; showUser = false; }

        const displayUser = act.user === userEmail ? 'You' : act.user;

        return `
    <div class="activity-item">
        <i class="fa-solid ${icon}" style="color: ${iconColor}; font-size: 0.8rem;"></i>
        <div style="font-size: 0.85rem;">
            ${showUser ? `<strong>${displayUser}</strong> ` : ''}${actionText}
            <div style="font-size: 0.7rem; color: var(--text-muted);">${new Date(act.date).toLocaleString()}</div>
        </div>
    </div>`;
    }).join('');
}