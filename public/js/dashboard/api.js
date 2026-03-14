const API_BASE = 'http://localhost:5001/api/admin';
const getAuthHeaders = () => ({ 'x-auth-token': localStorage.getItem('token') });

// 1. STATS (Upgraded with local Trend Calculation)
export async function fetchStats() {
    const res = await fetch(`${API_BASE}/stats`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error("Stats Fetch Failed");
    const stats = await res.json();

    try {
        // 🧮 CALCULATION: Fetch users to determine the 7-day growth trend
        const usersRes = await fetch(`${API_BASE}/users`, { headers: getAuthHeaders() });
        const allUsers = await usersRes.json();

        if (Array.isArray(allUsers)) {
            const now = new Date();
            const sevenDaysAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));

            // Count users who joined in the last 7 days
            const recentUsers = allUsers.filter(u => {
                // Safely check for either createdAt or date depending on your Schema
                const userDate = new Date(u.createdAt || u.date || u._id.getTimestamp?.() || now);
                return userDate >= sevenDaysAgo;
            }).length;

            const olderUsers = allUsers.length - recentUsers;

            let trend = 0;
            if (olderUsers > 0) {
                trend = ((recentUsers / olderUsers) * 100).toFixed(1);
            } else if (recentUsers > 0) {
                trend = 100; // 100% growth if all users are brand new
            }

            stats.trend = trend;
            stats.total = allUsers.length; // Ensure total is perfectly synced
        }
    } catch (e) {
        console.warn("⚠️ Trend calculation skipped/failed", e);
        stats.trend = 0;
    }

    return stats;
}

// 2. USERS (Watchlist)
export async function fetchUsers() {
    const res = await fetch(`${API_BASE}/risky`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error("Users Fetch Failed");
    return res.json();
}

// --- 6. SYSTEM DIRECTORY ---
export async function fetchAllUsers() {
    const res = await fetch(`${API_BASE}/users`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error("Failed to fetch user directory");
    const data = await res.json();

    if (!Array.isArray(data)) {
        console.warn("API returned non-array data for users, defaulting to []");
        return [];
    }
    return data;
}

// 3. LOGS (Live Feed)
export async function fetchLogs(userId = null) {
    const url = userId ? `${API_BASE}/logs/${userId}` : `${API_BASE}/logs`;
    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error("Logs Fetch Failed");
    const data = await res.json();

    if (!Array.isArray(data)) {
        console.warn("API returned non-array data, defaulting to []");
        return [];
    }
    return data;
}

// --- 5. TRAFFIC ANALYTICS ---
export async function fetchTrafficData() {
    const res = await fetch(`${API_BASE}/analytics/traffic`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error("Traffic Fetch Failed");
    const data = await res.json();

    if (!data.labels || !data.dataPoints) {
        return { labels: [], dataPoints: [] };
    }
    return data;
}

// 4. ACTIONS (Ban/Unban)
export async function toggleBanAPI(userId) {
    const res = await fetch(`${API_BASE}/ban/${userId}`, {
        method: 'POST',
        headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error("Ban Action Failed");
    return res.json();
}

// --- 7. GEMINI AI AGENT ---
export async function runAISweep() {
    const res = await fetch(`${API_BASE}/ai-sweep`, {
        method: 'POST',
        headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error("AI Sweep request failed");
    return res.json();
}

// --- 8. USER BEHAVIORAL AI PROFILE ---
export async function fetchUserAIProfile(userId) {
    const res = await fetch(`${API_BASE}/ai-profile/${userId}`, {
        headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error("Failed to generate AI profile for user.");
    return res.json();
}

// --- 9. USER TRUST SCORE CHART DATA ---
export async function fetchUserChartData(userId) {
    const res = await fetch(`${API_BASE}/user-chart/${userId}`, {
        headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error("Failed to fetch user chart analytics.");
    return res.json();
}