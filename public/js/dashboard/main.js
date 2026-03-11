import { fetchStats, fetchUsers, fetchAllUsers, fetchLogs, toggleBanAPI, fetchTrafficData } from './api.js';
import { renderStats, renderUserTable, renderLogs, setLogFilterMode, renderTrafficChart, renderAllUsersModal } from './ui.js';

// --- GLOBAL STATE ---
let activeFilterId = null; // If set, we only fetch logs for this user

// 🎛️ NEW: Separate state for Users and Logs
let currentUserSearch = "";
let currentUserSort = "risk-high";

let currentLogSearch = "";
let currentLogSort = "recent";

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
            fetchUsers(),
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

        if (currentLogSort === 'oldest') {
            processedLogs.reverse(); // Assuming API returns recent first
        }

        renderStats(stats);
        renderUserTable(processedUsers); // Pass the manipulated array instead of rawUsers
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
        if(confirm("Logout Admin?")) {
            localStorage.removeItem('token');
            window.location.href = 'login.html';
        }
    });

    // View All Users Modal
    document.getElementById('btn-view-users').addEventListener('click', async () => {
        const modal = document.getElementById('users-modal');
        modal.classList.remove('hidden');

        try {
            const allUsers = await fetchAllUsers();
            renderAllUsersModal(allUsers);
        } catch (err) {
            console.error("Failed to load user directory", err);
        }
    });

    // Close Modal
    document.getElementById('btn-close-modal').addEventListener('click', () => {
        document.getElementById('users-modal').classList.add('hidden');
    });

    // 🎛️ NEW: User Table Controls
    document.getElementById('userSearchInput').addEventListener('input', (e) => {
        currentUserSearch = e.target.value.toLowerCase().trim();
        refreshDashboard();
    });

    document.getElementById('userSortSelect').addEventListener('change', (e) => {
        currentUserSort = e.target.value;
        refreshDashboard();
    });

    // 🎛️ NEW: Log Feed Controls
    document.getElementById('logSearchInput').addEventListener('input', (e) => {
        currentLogSearch = e.target.value.toLowerCase().trim();
        refreshDashboard();
    });

    document.getElementById('logSortSelect').addEventListener('change', (e) => {
        currentLogSort = e.target.value;
        refreshDashboard();
    });

    // Table Actions (Freeze / Filter)
    document.getElementById('user-table-body').addEventListener('click', async (e) => {
        // e.target might be the icon inside the button, so we use .closest() to ensure we get the button
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
            refreshDashboard();
        }
    });
}

// --- 4. INIT ---
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    setupEventListeners();

    refreshDashboard(); // Run once immediately
    setInterval(refreshDashboard, 2000); // Poll every 2 seconds
});