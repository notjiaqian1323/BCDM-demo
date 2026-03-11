// --- STATE TRACKING ---
let previousUserStates = {};
let isFilterMode = false;
let trafficChartInstance = null;

// --- 4. CHART RENDERER ---
export function renderTrafficChart(chartData) {
    const ctx = document.getElementById('trafficChart');
    if (!ctx) return;

    if (trafficChartInstance) {
        trafficChartInstance.data.labels = chartData.labels;
        trafficChartInstance.data.datasets[0].data = chartData.dataPoints;
        trafficChartInstance.update('none');
        return;
    }

    trafficChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: chartData.labels,
            datasets: [{
                label: 'Security Events',
                data: chartData.dataPoints,
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.4,
                pointRadius: 3,
                pointBackgroundColor: '#10b981'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#94a3b8', stepSize: 1 } },
                x: { grid: { display: false }, ticks: { color: '#94a3b8' } }
            }
        }
    });
}

// --- 1. LOGS RENDERER ---
export function renderLogs(logs) {
    const container = document.getElementById('live-feed-container');

    if (!Array.isArray(logs)) {
        console.error("🚨 renderLogs Error: Expected an array, but got:", logs);
        const errorText = logs.msg || logs.message || "Failed to parse stream data.";
        container.innerHTML = `<div class="log-entry text-red">⚠️ Stream Error: ${errorText}</div>`;
        return;
    }

    if (logs.length === 0) {
        if (!isFilterMode) container.innerHTML = '<div class="log-entry text-secondary">Waiting for stream...</div>';
        return;
    }

    // 🛠️ THE FIX: Correctly defining variables before injecting into HTML
    const newHtml = logs.map(log => {
        const time = log.timestamp || log.date ? new Date(log.timestamp || log.date).toLocaleTimeString() : "00:00:00";
        const typeClass = getLogColor(log.type);
        const displayType = log.type || 'INFO';
        const displayMsg = log.message || log.details || '';

        return `
            <div class="log-entry">
                <span class="log-time">${time}</span>
                <span class="log-type ${typeClass}">${displayType}</span>
                <div class="log-message-container">
                    <span class="log-message">${displayMsg}</span>
                </div>
            </div>
        `;
    }).join('');

    if (container.innerHTML !== newHtml) {
        container.innerHTML = newHtml;
    }
}

export function setLogFilterMode(active, userName = "") {
    isFilterMode = active;
    const header = document.querySelector('.panel-header .pulse-red').nextSibling;
    if (active) {
        header.textContent = ` 🔍 Filtering: ${userName}`;
    } else {
        header.textContent = ` Live Security Event Log`;
    }
}

// --- 2. USER TABLE RENDERER ---
export function renderUserTable(users) {
    const tbody = document.getElementById('user-table-body');

    users.forEach(user => {
        const rowId = `row-${user._id}`;
        const stateKey = `${user.trustScore}-${user.isBanned}`;

        let row = document.getElementById(rowId);

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
        else if (previousUserStates[user._id] !== stateKey) {
            row.querySelector('.score-cell').innerHTML = getScoreBadge(user.trustScore);
            const btn = row.querySelector('[data-action="ban"]');
            btn.className = `btn-action ${user.isBanned ? 'btn-unfreeze' : 'btn-freeze'}`;
            btn.innerText = user.isBanned ? 'UNFREEZE' : 'FREEZE';
            previousUserStates[user._id] = stateKey;
        }
    });
}

// --- STATS RENDERER ---
export function renderStats(data) {
    // Total Users
    const totalEl = document.getElementById('stat-total');
    if (totalEl) totalEl.innerText = data.total || 0;

    // 📈 NEW: Render the Trend UI
    const trendEl = document.getElementById('stat-trend');
    if (trendEl && data.trend !== undefined) {
        const trendVal = parseFloat(data.trend);
        trendEl.innerText = trendVal >= 0 ? `+${trendVal}%` : `${trendVal}%`;

        // Dynamically color the text based on positive/negative growth
        trendEl.className = trendVal >= 0 ? 'text-green font-bold' : 'text-red font-bold';
    }

    const statusEl = document.getElementById('stat-system-status');
    if (statusEl && statusEl.innerText !== "OPERATIONAL") {
        statusEl.innerText = "OPERATIONAL";
    }
}

// --- NEW: ALL USERS MODAL RENDERER ---
export function renderAllUsersModal(users) {
    const tbody = document.getElementById('all-users-list');
    tbody.innerHTML = users.map(user => {
        return `
        <tr>
            <td style="font-family: monospace; color: #64748b;">${user._id.substring(0, 6)}</td>
            <td style="font-weight: bold;">${user.username}</td>
            <td>${user.email}</td>
            <td>
                <span class="${user.isBanned ? 'text-red' : 'text-green'}">
                    ${user.isBanned ? 'BANNED' : 'ACTIVE'} (${user.trustScore})
                </span>
            </td>
            <td style="text-align: right;">
                <button class="action-btn" style="background: var(--primary); padding: 5px 10px;" 
                        onclick="window.location.href='../user_profile.html?id=${user._id}'" title="View Full Profile">
                    <i class="fa-solid fa-arrow-right"></i>
                </button>
            </td>
        </tr>`;
    }).join('');
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