// --- STATE TRACKING (To prevent "Ghost Button" glitch) ---
let previousUserStates = {};
let isFilterMode = false; // To track if we are viewing specific logs

// --- 1. LOGS RENDERER ---
export function renderLogs(logs) {
    const container = document.getElementById('live-feed-container');

    // If empty or filtering
    if (logs.length === 0) {
        if (!isFilterMode) container.innerHTML = '<div class="log-entry text-secondary">Waiting for stream...</div>';
        return;
    }

    // Generate HTML
    const newHtml = logs.map(log => `
        <div class="log-entry">
            <span class="log-time">[${new Date(log.timestamp).toLocaleTimeString()}]</span>
            <span class="log-type ${getLogColor(log.type)}">${log.type}</span>
            <span class="log-detail">${log.message}</span>
        </div>
    `).join('');

    // Only touch DOM if content changed (Performance)
    if (container.innerHTML !== newHtml) {
        container.innerHTML = newHtml;
        // Feature: Auto-Scroll to bottom
        container.scrollTop = container.scrollHeight;
    }
}

export function setLogFilterMode(active, userName = "") {
    isFilterMode = active;
    const header = document.querySelector('.panel-header .pulse-red').nextSibling;
    if (active) {
        header.textContent = ` 🔍 Filtering: ${userName}`;
        // Pause auto-refreshing logs in main.js logic if needed,
        // or just let the API fetch the specific user logs.
    } else {
        header.textContent = ` Live Security Event Log`;
    }
}

// --- 2. USER TABLE RENDERER (The "Ghost Button" Fix) ---
export function renderUserTable(users) {
    const tbody = document.getElementById('user-table-body');

    users.forEach(user => {
        const rowId = `row-${user._id}`;
        const stateKey = `${user.trustScore}-${user.isBanned}`; // Unique signature

        let row = document.getElementById(rowId);

        // A. CREATE ROW (If new)
        if (!row) {
            row = document.createElement('tr');
            row.id = rowId;
            row.innerHTML = `
                <td>
                    <div style="font-weight:bold;">${user.username || 'User'}</div>
                    <small style="color:#64748b">ID: ${user._id.substring(0,8)}...</small>
                </td>
                <td class="score-cell">
                    ${getScoreBadge(user.trustScore)}
                </td>
                <td>
                    <button class="btn-action ${user.isBanned ? 'btn-unfreeze' : 'btn-freeze'}" 
                            data-action="ban" data-id="${user._id}">
                        ${user.isBanned ? 'UNFREEZE' : 'FREEZE'}
                    </button>
                    <button class="btn-action" 
                            data-action="logs" data-id="${user._id}" data-name="${user.username}">
                        LOGS
                    </button>
                </td>
            `;
            tbody.appendChild(row);
            previousUserStates[user._id] = stateKey;
        }
        // B. UPDATE ROW (Only if changed)
        else if (previousUserStates[user._id] !== stateKey) {
            // Update Score
            row.querySelector('.score-cell').innerHTML = getScoreBadge(user.trustScore);

            // Update Freeze Button
            const btn = row.querySelector('[data-action="ban"]');
            btn.className = `btn-action ${user.isBanned ? 'btn-unfreeze' : 'btn-freeze'}`;
            btn.innerText = user.isBanned ? 'UNFREEZE' : 'FREEZE';

            previousUserStates[user._id] = stateKey;
        }
    });
}

// --- 3. STATS RENDERER ---
export function renderStats(data) {
    document.getElementById('stat-total').innerText = data.total;
    const riskEl = document.getElementById('stat-risk');
    riskEl.innerText = data.risk;

    // Dynamic Color for At-Risk
    if (data.risk === 0) {
        riskEl.className = "hud-value text-green";
        riskEl.closest('.hud-item').classList.remove('hud-alert');
    } else {
        riskEl.className = "hud-value text-red";
        riskEl.closest('.hud-item').classList.add('hud-alert');
    }

    document.getElementById('stat-system-status').innerHTML = `<span class="pulse">●</span> OPERATIONAL`;
    document.getElementById('stat-system-status').className = "hud-value text-green";
}

// --- HELPERS ---
function getLogColor(type) {
    const map = {
        'AUTH': 'text-green', 'SUCCESS': 'text-green',
        'CRITICAL': 'text-red', 'SECURITY': 'text-red',
        'WARN': 'text-amber', 'UPLOAD': 'text-blue'
    };
    return map[type] || 'text-primary';
}

function getScoreBadge(score) {
    let color = 'score-high';
    if (score < 50) color = 'score-critical';
    else if (score < 80) color = 'score-low';
    return `<span class="score-indicator ${color}">${score}</span>`;
}