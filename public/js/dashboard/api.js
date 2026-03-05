const API_BASE = 'http://localhost:5002/api/admin';
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

// --- 6. SYSTEM DIRECTORY ---
export async function fetchAllUsers() {
    const res = await fetch(`${API_BASE}/users`, { headers: getAuthHeaders() });

    if (!res.ok) throw new Error("Failed to fetch user directory");

    const data = await res.json();

    // 🛡️ Armor: Ensure it always returns an array
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

    // 🛡️ The Shield: If data is an object with no length, force it to be an empty array
    if (!Array.isArray(data)) {
        console.warn("API returned non-array data, defaulting to []");
        return [];
    }

    return data;
}

// --- 5. TRAFFIC ANALYTICS ---
export async function fetchTrafficData() {
    // Fetches the grouped log data from the MongoDB aggregation route
    const res = await fetch(`${API_BASE}/analytics/traffic`, { headers: getAuthHeaders() });

    if (!res.ok) throw new Error("Traffic Fetch Failed");

    const data = await res.json();

    // 🛡️ Safe fallback just in case the DB returns nothing
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
    return res.json(); // Returns updated user
}