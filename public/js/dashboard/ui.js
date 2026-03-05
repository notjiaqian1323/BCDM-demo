// --- STATE TRACKING (To prevent "Ghost Button" glitch) ---
let previousUserStates = {};
let isFilterMode = false; // To track if we are viewing specific logs
let trafficChartInstance = null;

// --- 4. CHART RENDERER ---
export function renderTrafficChart(chartData) {
    const ctx = document.getElementById('trafficChart');
    if (!ctx) return; // Failsafe if canvas is missing

    // If the chart already exists, just update the data smoothly
    if (trafficChartInstance) {
        trafficChartInstance.data.labels = chartData.labels;
        trafficChartInstance.data.datasets[0].data = chartData.dataPoints;
        trafficChartInstance.update('none'); // 'none' disables the bouncy animation on every tick
        return;
    }

    // If it's the first load, create the chart
    trafficChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: chartData.labels,
            datasets: [{
                label: 'Security Events',
                data: chartData.dataPoints,
                borderColor: '#3b82f6', // Cyber blue
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.4, // Gives it that smooth, modern curve
                pointRadius: 3,
                pointBackgroundColor: '#10b981' // Green dots
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false } // Hides the legend for a cleaner look
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#94a3b8', stepSize: 1 }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: '#94a3b8' }
                }
            }
        }
    });
}


// --- 1. LOGS RENDERER ---
// --- 1. LOGS RENDERER ---
export function renderLogs(logs) {
    const container = document.getElementById('live-feed-container');

    // 🛑 THE FIX: Safeguard against non-array data
    if (!Array.isArray(logs)) {
        console.error("🚨 renderLogs Error: Expected an array, but got:", logs);

        // Optionally display the error in the feed so you don't stare at a blank box
        const errorText = logs.msg || logs.message || "Failed to parse stream data.";
        container.innerHTML = `<div class="log-entry text-red">⚠️ Stream Error: ${errorText}</div>`;
        return; // Stop the function here!
    }

    // If empty or filtering
    if (logs.length === 0) {
        if (!isFilterMode) container.innerHTML = '<div class="log-entry text-secondary">Waiting for stream...</div>';
        return;
    }

    // Generate HTML
    const newHtml = logs.map(log => {
        // Safe date parsing fallback
        const timeString = log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : "00:00:00";

        return `
        <div class="log-entry">
            <span class="log-time">[${timeString}]</span>
            <span class="log-type ${getLogColor(log.type)}">${log.type || 'UNKNOWN'}</span>
            <span class="log-detail">${log.message || 'No details provided'}</span>
        </div>`;
    }).join('');

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

// --- STATS RENDERER (Cleaned up) ---
export function renderStats(data) {
    document.getElementById('stat-total').innerText = data.total;
    // We removed the At-Risk elements, so we just ensure status says Operational
    const statusEl = document.getElementById('stat-system-status');
    if (statusEl.innerText !== "OPERATIONAL") statusEl.innerText = "OPERATIONAL";
}

// --- NEW: ALL USERS MODAL RENDERER ---
export function renderAllUsersModal(users) {
    const tbody = document.getElementById('all-users-list');
    tbody.innerHTML = users.map(user => {
        // Simple 1-line layout
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