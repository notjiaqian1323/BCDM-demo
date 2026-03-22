import { fetchAllUsers, toggleBanAPI } from './api.js';
// Note: We will add fetchUserAIProfile & fetchUserChartData to api.js next!
import { fetchUserAIProfile, fetchUserChartData } from './api.js';

// --- STATE ---
let directoryUsers = [];
let trustChartInstance = null;
let currentProfileUserId = null;

// --- 1. INITIALIZATION & DATA FETCHING ---
async function loadDirectory() {
    try {
        directoryUsers = await fetchAllUsers();
        applyFiltersAndRender();
    } catch (err) {
        console.error("Failed to load directory:", err);
        document.getElementById('directory-table-body').innerHTML = `<tr><td colspan="6" class="text-red text-center">Failed to load directory data.</td></tr>`;
    }
}

// --- 2. FILTERING & RENDERING ---
function applyFiltersAndRender() {
    let filtered = [...directoryUsers];
    const searchStr = document.getElementById('dirSearchInput').value.toLowerCase().trim();
    const statusFilter = document.getElementById('dirStatusSelect').value;
    const sortFilter = document.getElementById('dirSortSelect').value;

    // A. Search
    if (searchStr) {
        filtered = filtered.filter(u =>
            (u.username && u.username.toLowerCase().includes(searchStr)) ||
            (u.email && u.email.toLowerCase().includes(searchStr)) ||
            (u._id && u._id.toLowerCase().includes(searchStr)) // 🛠️ THE FIX: Added ._id here
        );
    }

    // B. Status
    if (statusFilter === 'active') filtered = filtered.filter(u => !u.isBanned);
    if (statusFilter === 'banned') filtered = filtered.filter(u => u.isBanned);

    // C. Sort
    filtered.sort((a, b) => {
        if (sortFilter === 'risk-high') return a.trustScore - b.trustScore;
        if (sortFilter === 'recent') return b._id.localeCompare(a._id);
        if (sortFilter === 'alpha') return (a.username || "").localeCompare(b.username || "");
        return 0;
    });

    renderTable(filtered);
}

function renderTable(users) {
    const tbody = document.getElementById('directory-table-body');

    if (users.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 20px;">No users found matching filters.</td></tr>`;
        return;
    }

    tbody.innerHTML = users.map(user => {
        // 🛠️ THE FIX: Mathematically extract the exact creation date from the MongoDB _id string
        const timestamp = parseInt(user._id.substring(0, 8), 16) * 1000;
        const joinDate = new Date(timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

        return `
        <tr>
            <td style="font-family: monospace; color: var(--text-secondary); font-size: 0.8rem;">${user._id.substring(0,8)}</td>
            <td>
                <div style="font-weight: bold;">${user.username || 'Unnamed'}</div>
                <div style="font-size: 0.8rem; color: var(--text-secondary);">${user.email}</div>
            </td>
            <td>${joinDate}</td>
            <td>
                <span class="score-indicator ${user.trustScore < 50 ? 'score-critical' : (user.trustScore < 80 ? 'score-low' : 'score-high')}">
                    ${user.trustScore}
                </span>
            </td>
            <td>
                <span style="padding: 4px 8px; border-radius: 4px; font-size: 0.8rem; background: ${user.isBanned ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)'}; color: ${user.isBanned ? 'var(--accent-red)' : 'var(--accent-green)'};">
                    ${user.isBanned ? 'FROZEN' : 'ACTIVE'}
                </span>
            </td>
            <td style="text-align: right;">
                <button class="btn-action" style="background: var(--primary);" onclick="window.openUserProfile('${user._id}')">
                    <i class="fa-solid fa-eye"></i> View Profile
                </button>
            </td>
        </tr>`;
    }).join('');
}

// --- 3. THE MODAL & AI COPILOT LOGIC ---
// Exposed to window so the inline onclick button can trigger it
window.openUserProfile = async (userId) => {
    const user = directoryUsers.find(u => u._id === userId);
    if (!user) return;
    currentProfileUserId = userId;

    // A. Open Modal & Inject Hard Data
    document.getElementById('profile-modal').classList.remove('hidden');
    document.getElementById('prof-username').innerText = user.username || 'Unnamed User';
    document.getElementById('prof-email').innerText = user.email;
    document.getElementById('prof-id').innerText = user._id;
    document.getElementById('prof-joined').innerText = user.createdAt || user.date ? new Date(user.createdAt || user.date).toLocaleDateString() : 'Unknown';
    document.getElementById('prof-score').innerText = user.trustScore;
    document.getElementById('prof-status').innerHTML = user.isBanned ? '<span class="text-red">FROZEN</span>' : '<span class="text-green">ACTIVE</span>';

    // Update Freeze Button State
    const freezeBtn = document.getElementById('prof-btn-freeze');
    freezeBtn.className = `btn-action ${user.isBanned ? 'btn-unfreeze' : 'btn-freeze'}`;
    freezeBtn.innerHTML = `<i class="fa-solid fa-gavel"></i> ${user.isBanned ? 'Unfreeze Account' : 'Freeze Account'}`;

    // B. Reset AI & Chart UI
    document.getElementById('prof-ai-summary').innerHTML = '<div class="pulse text-blue" style="text-align: center;"><i class="fa-solid fa-spinner fa-spin"></i> Analyzing behavioral history...</div>';

    // C. Fetch Deep Data (Parallel for speed)
    try {
        const [aiData, chartData] = await Promise.all([
            fetchUserAIProfile(userId),
            fetchUserChartData(userId)
        ]);

        // Inject AI Summary
        document.getElementById('prof-ai-summary').innerHTML = aiData.analysis;

        // Render Chart
        renderTrustChart(chartData);

    } catch (err) {
        document.getElementById('prof-ai-summary').innerHTML = '<div class="text-red"><i class="fa-solid fa-triangle-exclamation"></i> Failed to generate AI summary.</div>';
    }
};

function renderTrustChart(data) {
    const ctx = document.getElementById('userTrustChart');
    if (!ctx) return;

    // Destroy old chart if it exists so we don't get overlapping glitches
    if (trustChartInstance) {
        trustChartInstance.destroy();
    }

    trustChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: data.labels,
            datasets: [{
                label: 'Trust Score',
                data: data.dataPoints,
                borderColor: '#f59e0b', // Amber color for risk tracking
                backgroundColor: 'rgba(245, 158, 11, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.3,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { min: 0, max: 100, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
                x: { grid: { display: false }, ticks: { color: '#94a3b8' } }
            }
        }
    });
}

// --- 4. CSV EXPORT UTILITY ---
function exportDirectoryToCSV() {
    if (directoryUsers.length === 0) return alert("No data to export.");

    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "User ID,Username,Email,Trust Score,Status,Join Date\n"; // Headers

    directoryUsers.forEach(u => {
        // 🛠️ THE FIX: Mathematically extract the exact creation date from the MongoDB _id string
        const timestamp = parseInt(u._id.substring(0, 8), 16) * 1000;

        // Added quotes around fields just in case usernames contain commas!
        const joinDate = new Date(timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        const status = u.isBanned ? "Frozen" : "Active";

        // Wrapping values in quotes prevents CSV formatting breaks if a username is "Smith, John"
        const row = `"${u._id}","${u.username}","${u.email}","${u.trustScore}","${status}","${joinDate}"`;
        csvContent += row + "\n";
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `BCDS_User_Directory_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// --- 5. EVENT LISTENERS ---
document.addEventListener('DOMContentLoaded', () => {
    loadDirectory();

    // Table Filters
    document.getElementById('dirSearchInput').addEventListener('input', applyFiltersAndRender);
    document.getElementById('dirStatusSelect').addEventListener('change', applyFiltersAndRender);
    document.getElementById('dirSortSelect').addEventListener('change', applyFiltersAndRender);

    // CSV Export
    document.getElementById('btn-export-all').addEventListener('click', exportDirectoryToCSV);

    // Close Modal
    document.getElementById('btn-close-profile').addEventListener('click', () => {
        document.getElementById('profile-modal').classList.add('hidden');
        currentProfileUserId = null;
    });

    // Profile Modal Action: Toggle Freeze
    document.getElementById('prof-btn-freeze').addEventListener('click', async () => {
        if (!currentProfileUserId) return;
        if (!confirm("Are you sure you want to change this user's access?")) return;

        try {
            await toggleBanAPI(currentProfileUserId);
            // Reload the underlying directory to sync data, then re-open modal to show changes
            await loadDirectory();
            window.openUserProfile(currentProfileUserId);
        } catch (err) {
            alert("Action failed: " + err.message);
        }
    });

    // 📄 NEW: PDF Generation Logic
    const btnReport = document.getElementById('prof-btn-report');
    if (btnReport) {
        btnReport.addEventListener('click', async (e) => {
            const btn = e.currentTarget;

            // 1. UI Loading State
            const originalText = btn.innerHTML;
            btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Generating PDF...`;
            btn.disabled = true;

            try {
                // Initialize jsPDF
                const { jsPDF } = window.jspdf;

                // 2. Target the specific UI block we want to capture
                // We are targeting the modal body so it grabs the data, AI text, and chart
                const captureElement = document.querySelector('.modal-body');

                // 3. Take a high-res screenshot
                const canvas = await html2canvas(captureElement, {
                    scale: 2, // Doubles the pixel density for crisp text and charts
                    backgroundColor: '#1e293b', // Match your dark theme panel color
                    useCORS: true, // Helps render any external fonts/icons
                    logging: false
                });

                const imgData = canvas.toDataURL('image/png');

                // 4. Calculate dimensions for an A4 page
                const pdf = new jsPDF('p', 'mm', 'a4'); // Portrait, millimeters, A4 size
                const pdfWidth = pdf.internal.pageSize.getWidth();

                // Calculate height proportionally to maintain aspect ratio
                const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

                // 5. Build the PDF Document
                // Add a custom title at the top
                const username = document.getElementById('prof-username').innerText;
                pdf.setFontSize(16);
                pdf.setFont('helvetica', 'bold');
                pdf.text(`BCDS Security Dossier: ${username}`, 10, 15);

                // Inject the screenshot just below the title
                pdf.addImage(imgData, 'PNG', 0, 20, pdfWidth, pdfHeight);

                // 6. Trigger Download
                const safeFilename = username.replace(/[^a-z0-9]/gi, '_'); // Remove special characters
                pdf.save(`BCDS_Security_Report_${safeFilename}.pdf`);

            } catch (err) {
                console.error("PDF Generation Error:", err);
                alert("Failed to generate the security report. Please try again.");
            } finally {
                // Restore Button State
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        });
    }
});