import { fetchStats, fetchUsers, fetchAllUsers, fetchLogs, toggleBanAPI, fetchTrafficData } from './api.js';
import { renderStats, renderUserTable, renderLogs, setLogFilterMode, renderTrafficChart, renderAllUsersModal } from './ui.js';
// --- GLOBAL STATE ---
let activeFilterId = null; // If set, we only fetch logs for this user

// --- 1. AUTH CHECK (From your old script) ---
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
        const [stats, users, logs, traffic] = await Promise.all([
            fetchStats(),
            fetchUsers(),
            fetchLogs(activeFilterId), // Pass filter ID if active
            fetchTrafficData(),
        ]);

        renderStats(stats);
        renderUserTable(users);
        renderLogs(logs);
        renderTrafficChart(traffic);

    } catch (err) {
        console.error("Sync Error:", err);
        // Optional: Show offline status in UI
    }
}

// --- 3. EVENT HANDLERS (The "Delegation" Pattern) ---
// We attach ONE listener to the table body to handle all buttons
function setupEventListeners() {

    // Logout
    document.getElementById('btn-logout').addEventListener('click', () => {
        if(confirm("Logout Admin?")) {
            localStorage.removeItem('token');
            window.location.href = 'login.html';
        }
    });

    // Inside your setupEventListeners() function, add:
    document.getElementById('btn-view-users').addEventListener('click', async () => {
        const modal = document.getElementById('users-modal');
        modal.classList.remove('hidden'); // Show modal immediately

        try {
            // Fetch all users (not just risky ones)
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

    // Table Actions (Freeze / Filter)
    document.getElementById('user-table-body').addEventListener('click', async (e) => {
        const btn = e.target;
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
                // Toggle OFF
                activeFilterId = null;
                setLogFilterMode(false);
                btn.innerText = "LOGS";
                btn.classList.remove('active-filter');
            } else {
                // Toggle ON
                activeFilterId = userId;
                setLogFilterMode(true, btn.dataset.name);
                btn.innerText = "CLEAR";
                btn.classList.add('active-filter'); // Add CSS for this state if you want
            }
            refreshDashboard(); // Fetch immediately
        }
    });
}

// --- 4. INIT ---
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    setupEventListeners();

    refreshDashboard(); // Run once
    setInterval(refreshDashboard, 2000); // Run every 2s (Better than 1s for performance)
});