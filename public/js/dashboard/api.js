const API_BASE = 'http://localhost:5000/api/admin';
const getAuthHeaders = () => ({ 'x-auth-token': localStorage.getItem('token') });

// 1. STATS
export async function fetchStats() {
    const res = await fetch(`${API_BASE}/stats`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error("Stats Fetch Failed");
    return res.json();
}

// 2. USERS (Watchlist)
export async function fetchUsers() {
    const res = await fetch(`${API_BASE}/risky`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error("Users Fetch Failed");
    return res.json();
}

// 3. LOGS (Live Feed)
export async function fetchLogs(userId = null) {
    // If userId is provided, hit the specific filter endpoint
    const url = userId ? `${API_BASE}/logs/${userId}` : `${API_BASE}/logs`;
    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error("Logs Fetch Failed");
    return res.json();
}

// 4. ACTIONS (Ban/Unban)
export async function toggleBanAPI(userId) {
    const res = await fetch(`${API_BASE}/ban/${userId}`, {
        method: 'POST',
        headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error("Ban Action Failed");
    return res.json(); // Returns updated user
}