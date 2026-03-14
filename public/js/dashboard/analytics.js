import { fetchLogs } from './api.js';

// --- STATE MANAGEMENT ---
let allLogs = [];
let filteredLogs = [];
let currentPage = 1;
const logsPerPage = 10;

// Chart Instances (Stored so we can destroy and redraw them)
let distributionChartInstance = null;
let velocityChartInstance = null;

// --- 1. INITIALIZATION ---
async function initAnalytics() {
    try {
        // Fetch ALL logs from the system
        allLogs = await fetchLogs();
        filteredLogs = [...allLogs];

        applyFiltersAndRender();
    } catch (err) {
        console.error("Failed to load analytics data:", err);
        document.getElementById('analytics-table-body').innerHTML = `<tr><td colspan="5" class="text-red text-center">Failed to load system logs.</td></tr>`;
    }
}

// --- 2. FILTERING & PAGINATION ENGINE ---
function applyFiltersAndRender() {
    const searchStr = document.getElementById('logSearch').value.toLowerCase().trim();
    const typeFilter = document.getElementById('logTypeFilter').value;

    // A. Apply Filters
    filteredLogs = allLogs.filter(log => {
        const matchesSearch =
            (log.message && log.message.toLowerCase().includes(searchStr)) ||
            (log.ipAddress && log.ipAddress.toLowerCase().includes(searchStr)) ||
            (log.user && String(log.user).toLowerCase().includes(searchStr));

        const matchesType = typeFilter === 'all' || log.type === typeFilter;

        return matchesSearch && matchesType;
    });

    // Reset to page 1 whenever filters change
    currentPage = 1;

    // B. Re-draw everything based on the new filtered dataset
    renderTable();
    renderPagination();
    drawDistributionChart();
    drawVelocityChart();
}

// --- 3. TABLE RENDERING ---
function renderTable() {
    const tbody = document.getElementById('analytics-table-body');

    if (filteredLogs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 20px;">No logs match your filters.</td></tr>`;
        return;
    }

    // Calculate Slice for Pagination
    const startIndex = (currentPage - 1) * logsPerPage;
    const endIndex = startIndex + logsPerPage;
    const logsToDisplay = filteredLogs.slice(startIndex, endIndex);

    tbody.innerHTML = logsToDisplay.map(log => {
        const dateObj = new Date(log.timestamp || log.date);
        const timeStr = !isNaN(dateObj) ? `${dateObj.toLocaleDateString()} ${dateObj.toLocaleTimeString()}` : "Unknown Time";

        // Color code the badge based on type
        let typeColor = 'var(--text-primary)';
        let bgOpacity = 'rgba(255,255,255,0.1)';
        if (log.type === 'SECURITY' || log.type === 'CRITICAL') { typeColor = 'var(--accent-red)'; bgOpacity = 'rgba(239, 68, 68, 0.15)'; }
        if (log.type === 'AUTH') { typeColor = 'var(--accent-green)'; bgOpacity = 'rgba(16, 185, 129, 0.15)'; }
        if (log.type === 'UPLOAD') { typeColor = 'var(--accent-blue)'; bgOpacity = 'rgba(59, 130, 246, 0.15)'; }
        if (log.type === 'WORKER') { typeColor = 'var(--accent-amber)'; bgOpacity = 'rgba(245, 158, 11, 0.15)'; }

        return `
        <tr>
            <td style="color: var(--text-secondary); font-size: 0.85rem;">${timeStr}</td>
            <td>
                <span style="padding: 4px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: bold; background: ${bgOpacity}; color: ${typeColor};">
                    ${log.type || 'UNKNOWN'}
                </span>
            </td>
            <td style="max-width: 300px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${log.message}">
                ${log.message}
            </td>
            <td style="font-family: monospace; color: var(--text-secondary);">${log.ipAddress || 'Internal'}</td>
            <td style="font-size: 0.85rem;">${log.location || 'Unknown'}</td>
        </tr>`;
    }).join('');
}

function renderPagination() {
    const totalPages = Math.ceil(filteredLogs.length / logsPerPage);
    const infoText = document.getElementById('pagination-info');
    const btnPrev = document.getElementById('btn-prev-page');
    const btnNext = document.getElementById('btn-next-page');

    if (filteredLogs.length === 0) {
        infoText.innerText = `Showing 0 logs`;
        btnPrev.disabled = true;
        btnNext.disabled = true;
        return;
    }

    const startIdx = ((currentPage - 1) * logsPerPage) + 1;
    const endIdx = Math.min(currentPage * logsPerPage, filteredLogs.length);

    infoText.innerText = `Showing ${startIdx}-${endIdx} of ${filteredLogs.length} logs`;

    btnPrev.disabled = currentPage === 1;
    btnNext.disabled = currentPage === totalPages;
}

// --- 4. DATA VISUALIZATION (CHART.JS) ---
function drawDistributionChart() {
    const ctx = document.getElementById('distributionChart');
    if (!ctx) return;
    if (distributionChartInstance) distributionChartInstance.destroy();

    // Tally up the log types
    const counts = { 'AUTH': 0, 'SECURITY': 0, 'UPLOAD': 0, 'WORKER': 0, 'OTHER': 0 };
    filteredLogs.forEach(log => {
        if (counts[log.type] !== undefined) counts[log.type]++;
        else counts['OTHER']++;
    });

    distributionChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Auth', 'Security', 'Uploads', 'Workers', 'Other'],
            datasets: [{
                data: [counts.AUTH, counts.SECURITY, counts.UPLOAD, counts.WORKER, counts.OTHER],
                backgroundColor: ['#10b981', '#ef4444', '#3b82f6', '#f59e0b', '#94a3b8'],
                borderWidth: 0,
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'right', labels: { color: '#e2e8f0', font: { family: 'Roboto Mono' } } }
            },
            cutout: '70%'
        }
    });
}

function drawVelocityChart() {
    const ctx = document.getElementById('velocityChart');
    if (!ctx) return;
    if (velocityChartInstance) velocityChartInstance.destroy();

    // Create an array of the last 7 days
    const labels = [];
    const dataPoints = [0, 0, 0, 0, 0, 0, 0];

    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        labels.push(d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' }));
    }

    // Map logs to their respective days
    filteredLogs.forEach(log => {
        const logDate = new Date(log.timestamp || log.date);
        const logDateString = logDate.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
        const dayIndex = labels.indexOf(logDateString);

        if (dayIndex !== -1) {
            dataPoints[dayIndex]++;
        }
    });

    velocityChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'System Events',
                data: dataPoints,
                backgroundColor: 'rgba(59, 130, 246, 0.5)',
                borderColor: '#3b82f6',
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8', stepSize: 1 } },
                x: { grid: { display: false }, ticks: { color: '#94a3b8' } }
            }
        }
    });
}

// --- 5. PDF REPORT GENERATOR ---
async function downloadAnalyticsReport(btn) {
    const originalText = btn.innerHTML;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Compiling PDF...`;
    btn.disabled = true;

    try {
        const { jsPDF } = window.jspdf;
        const captureElement = document.getElementById('analytics-report-zone'); // Grabs Charts AND the Table!

        // Take the screenshot
        const canvas = await html2canvas(captureElement, {
            scale: 2,
            backgroundColor: '#0f172a', // Background color of your body
            useCORS: true,
            logging: false
        });

        const imgData = canvas.toDataURL('image/png');

        // We use Landscape 'l' to fit the wide table and charts nicely
        const pdf = new jsPDF('l', 'mm', 'a4');
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

        // Header Title
        pdf.setFontSize(18);
        pdf.setFont('helvetica', 'bold');
        pdf.text(`BCDS Master Analytics Report`, 10, 15);
        pdf.setFontSize(10);
        pdf.setFont('helvetica', 'normal');
        pdf.text(`Generated on: ${new Date().toLocaleString()}`, 10, 22);

        // Inject the dashboard image
        pdf.addImage(imgData, 'PNG', 0, 30, pdfWidth, pdfHeight);

        pdf.save(`BCDS_System_Analytics_${new Date().toISOString().split('T')[0]}.pdf`);

    } catch (err) {
        console.error("PDF Export Error:", err);
        alert("Failed to export analytics report.");
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

// --- 6. EVENT LISTENERS ---
document.addEventListener('DOMContentLoaded', () => {
    initAnalytics();

    // Filters
    document.getElementById('logSearch').addEventListener('input', applyFiltersAndRender);
    document.getElementById('logTypeFilter').addEventListener('change', applyFiltersAndRender);

    // Pagination
    document.getElementById('btn-prev-page').addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            renderTable();
            renderPagination();
        }
    });

    document.getElementById('btn-next-page').addEventListener('click', () => {
        const totalPages = Math.ceil(filteredLogs.length / logsPerPage);
        if (currentPage < totalPages) {
            currentPage++;
            renderTable();
            renderPagination();
        }
    });

    // PDF Export
    document.getElementById('btn-export-analytics').addEventListener('click', (e) => downloadAnalyticsReport(e.currentTarget));
});