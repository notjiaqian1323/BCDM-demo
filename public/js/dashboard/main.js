import { fetchStats, fetchUsers, fetchAllUsers, fetchLogs, toggleBanAPI, fetchTrafficData } from './api.js';
import { renderStats, renderUserTable, renderLogs, setLogFilterMode, renderTrafficChart, renderAllUsersModal } from './ui.js';
import { runAISweep } from './api.js';

// --- GLOBAL STATE ---
let activeFilterId = null; // If set, we only fetch logs for this user

// 🎛️ NEW: Separate state for Users and Logs
let currentUserSearch = "";
let currentUserSort = "risk-high";

let currentLogSearch = "";
let currentLogSort = "recent";
let currentLogDate = "";

// --- 1. AUTH CHECK ---
function checkAuth() {
    const token = localStorage.getItem('token');
    if (!token) {
        console.warn("No token found. Redirecting...");
        window.location.href = 'login.html';
    }
}

// --- 2. MAIN LOOP (The "Engine") ---
async function refreshDashboard() {
    try {
        // Parallel fetching for speed
        const [stats, rawUsers, logs, traffic] = await Promise.all([
            fetchStats(),
            fetchAllUsers(),
            fetchLogs(activeFilterId),
            fetchTrafficData(),
        ]);

        // 🎛️ NEW: PROCESS USERS BEFORE RENDERING
        let processedUsers = rawUsers;

        // A. Apply Search Filter
        if (currentUserSearch) {
            processedUsers = processedUsers.filter(user =>
                (user.username && user.username.toLowerCase().includes(currentUserSearch)) ||
                (user.email && user.email.toLowerCase().includes(currentUserSearch)) ||
                (user._id && user._id.toLowerCase().includes(currentUserSearch))
            );
        }

        // B. Apply Sorting
        processedUsers.sort((a, b) => {
            if (currentUserSort === 'risk-high') return a.trustScore - b.trustScore;
            if (currentUserSort === 'risk-low') return b.trustScore - a.trustScore;
            if (currentUserSort === 'status') return (a.isBanned === b.isBanned) ? 0 : a.isBanned ? -1 : 1;
            if (currentUserSort === 'recent') return b._id.localeCompare(a._id);
            return 0;
        });

        // --- B. PROCESS LOGS ---
        let processedLogs = logs;
        if (currentLogSearch) {
            processedLogs = processedLogs.filter(log =>
                (log.message && log.message.toLowerCase().includes(currentLogSearch)) ||
                (log.type && log.type.toLowerCase().includes(currentLogSearch))
            );
        }

        // 2. 📅 NEW: Date Filter
        if (currentLogDate) {
            processedLogs = processedLogs.filter(log => {
                const logDate = new Date(log.timestamp || log.date).toISOString().split('T')[0];
                return logDate === currentLogDate;
            });
        }

        if (currentLogSort === 'oldest') {
            processedLogs.reverse(); // Assuming API returns recent first
        }
        renderStats(stats);
        renderUserTable(processedUsers);
        renderLogs(processedLogs);
        renderTrafficChart(traffic);

    } catch (err) {
        console.error("Sync Error:", err);
    }
}

// --- 3. EVENT HANDLERS (The "Delegation" Pattern) ---
function setupEventListeners() {

    // Logout
    document.getElementById('btn-logout').addEventListener('click', () => {
        if (confirm("Logout Admin?")) {
            localStorage.removeItem('token');
            window.location.href = 'login.html';
        }
    });

    // Safe User Table Controls
    const userSearchInput = document.getElementById('userSearchInput');
    if (userSearchInput) {
        userSearchInput.addEventListener('input', (e) => {
            currentUserSearch = e.target.value.toLowerCase().trim();
            refreshDashboard();
        });
    }

    // 📅 NEW: Log Date Filter Controls
    const logDateFilter = document.getElementById('logDateFilter');
    if (logDateFilter) {
        // Lock the maximum date to Today (prevents future selection)
        const today = new Date().toISOString().split('T')[0];
        logDateFilter.setAttribute('max', today);

        logDateFilter.addEventListener('change', (e) => {
            currentLogDate = e.target.value; // Format is automatically YYYY-MM-DD
            refreshDashboard();
        });
    }

    const userSortSelect = document.getElementById('userSortSelect');
    if (userSortSelect) {
        userSortSelect.addEventListener('change', (e) => {
            currentUserSort = e.target.value;
            refreshDashboard();
        });
    }

    // Safe Log Feed Controls
    const logSearchInput = document.getElementById('logSearchInput');
    if (logSearchInput) {
        logSearchInput.addEventListener('input', (e) => {
            currentLogSearch = e.target.value.toLowerCase().trim();
            refreshDashboard();
        });
    }

    const logSortSelect = document.getElementById('logSortSelect');
    if (logSortSelect) {
        logSortSelect.addEventListener('change', (e) => {
            currentLogSort = e.target.value;
            refreshDashboard();
        });
    }

    // 🤖 GEMINI AI SWEEP
    const btnForceScan = document.getElementById('btn-force-ai-scan');
    if (btnForceScan) {
        btnForceScan.addEventListener('click', async () => {
            const aiFeed = document.getElementById('ai-feed');

            // UI Loading State
            btnForceScan.disabled = true;
            btnForceScan.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Analyzing Logs...`;
            aiFeed.innerHTML = `
                <div style="margin-bottom: 15px; padding: 10px; background: rgba(59, 130, 246, 0.1); border-left: 3px solid var(--accent-blue);">
                    <i class="fa-solid fa-microchip pulse text-blue"></i> Digesting latest system telemetry...
                </div>
            `;

            try {
                const result = await runAISweep();
                let aiResponseHtml = result.analysis;
                let actionPanelHtml = "";

                // 🕵️‍♀️ REGEX PARSER: Look for [FREEZE_TARGET: some_id]
                const targetRegex = /\[FREEZE_TARGET:\s*([^\]]+)\]/g;
                let match;
                const targets = [];

                // Extract all targets and clean the tags from the main text
                while ((match = targetRegex.exec(aiResponseHtml)) !== null) {
                    targets.push(match[1].trim());
                }
                aiResponseHtml = aiResponseHtml.replace(targetRegex, '').trim();

                // 🎯 SPAWN THE ACTION BUTTONS IF TARGETS FOUND
                if (targets.length > 0) {
                    actionPanelHtml = `
                        <div style="margin-top: 15px; padding: 12px; background: rgba(239, 68, 68, 0.15); border: 1px solid var(--accent-red); border-radius: 6px;">
                            <strong class="text-red"><i class="fa-solid fa-triangle-exclamation pulse-red"></i> Action Recommended:</strong>
                            <div style="margin-top: 10px; display: flex; flex-direction: column; gap: 8px;">
                                ${targets.map(uid => `
                                    <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.3); padding: 8px 12px; border-radius: 4px; border: 1px solid var(--border-color);">
                                        <span style="font-family: monospace; color: var(--text-secondary);">Target: <span class="text-primary">${uid}</span></span>
                                        <button class="btn-action btn-freeze ai-action-btn" data-action="ban" data-id="${uid}">
                                            <i class="fa-solid fa-gavel"></i> FREEZE USER
                                        </button>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    `;
                }

                // Render the AI's response + The generated Action Panel
                aiFeed.innerHTML = `
                    <div style="margin-bottom: 15px; padding: 12px; background: rgba(16, 185, 129, 0.1); border-left: 3px solid var(--accent-green); border-radius: 4px; line-height: 1.5;">
                        ${aiResponseHtml}
                    </div>
                    ${actionPanelHtml}
                `;
            } catch (err) {
                aiFeed.innerHTML = `
                    <div style="margin-bottom: 15px; padding: 10px; background: rgba(239, 68, 68, 0.1); border-left: 3px solid var(--accent-red); border-radius: 4px;">
                        ⚠️ AI Agent Offline: Could not reach Vertex AI API.
                    </div>
                `;
            } finally {
                // Reset Button
                btnForceScan.disabled = false;
                btnForceScan.innerHTML = `<i class="fa-solid fa-radar"></i> Run Manual Threat Sweep`;
            }
        });
    } // <-- Properly closed the AI button block here
    // 🎯 NEW: AI Feed Action Delegation (For the dynamically spawned Freeze buttons)
    const aiFeed = document.getElementById('ai-feed');
    if (aiFeed) {
        aiFeed.addEventListener('click', async (e) => {
            const btn = e.target.closest('.ai-action-btn');
            if (!btn) return;

            const userId = btn.dataset.id;

            if (btn.dataset.action === 'ban') {
                if (!confirm(`Execute AI Recommendation: Freeze User ${userId}?`)) return;

                // Visual feedback while processing
                const originalText = btn.innerHTML;
                btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Executing...`;
                btn.disabled = true;

                try {
                    await toggleBanAPI(userId);
                    await refreshDashboard();
                    btn.innerHTML = `<i class="fa-solid fa-check"></i> FROZEN`;
                    btn.style.background = 'var(--accent-green)';
                    btn.style.borderColor = 'var(--accent-green)';
                } catch (err) {
                    alert("Failed to execute AI action: " + err.message);
                    btn.innerHTML = originalText;
                    btn.disabled = false;
                }
            }
        });
    }
    // Table Actions (Freeze / Filter) - Moved outside the AI block!
    const userTableBody = document.getElementById('user-table-body');
    if (userTableBody) {
        userTableBody.addEventListener('click', async (e) => {
            const btn = e.target.closest('.action-btn');
            if (!btn) return;

            const userId = btn.dataset.id;

            // A. HANDLE FREEZE/UNFREEZE
            if (btn.dataset.action === 'ban') {
                if (!confirm("Are you sure you want to modify this user's access?")) return;
                try {
                    await toggleBanAPI(userId);
                    refreshDashboard(); // Instant update
                } catch (err) {
                    alert("Action Failed: " + err.message);
                }
            }

            // B. HANDLE LOG FILTER
            if (btn.dataset.action === 'logs') {
                if (activeFilterId === userId) {
                    activeFilterId = null;
                    setLogFilterMode(false);
                    btn.innerText = "LOGS";
                    btn.classList.remove('active-filter');
                } else {
                    activeFilterId = userId;
                    setLogFilterMode(true, btn.dataset.name);
                    btn.innerText = "CLEAR";
                    btn.classList.add('active-filter');
                }
                await refreshDashboard();
            }
        });
    }
} // <-- END of setupEventListeners

// --- 4. INIT --- (Moved OUTSIDE the setup function!)
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    setupEventListeners();

    refreshDashboard(); // Run once immediately
    setInterval(refreshDashboard, 2000); // Poll every 2 seconds
});