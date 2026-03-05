// --- 1. FRONTEND BOUNCER (Check existing sessions) ---
const savedToken = localStorage.getItem('token');
const savedRole = localStorage.getItem('role');

if (savedToken) {
    if (savedRole === 'admin') {
        // Already logged in as admin? Go straight to Command Center
        window.location.href = 'admin_panel.html';
    } else {
        // Normal user snooping around the admin login? Kick them to dashboard
        console.warn("Unauthorized routing attempt intercepted.");
        window.location.href = 'dashboard.html';
    }
}

// --- 2. HANDLE ADMIN LOGIN ---
async function handleAdminAuth(e) {
    e.preventDefault();
    const errorDiv = document.getElementById('error-message');
    errorDiv.innerText = '';

    const submitBtn = document.getElementById('admin-submit');
    const originalText = submitBtn.innerText;

    // UI Loading State
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Verifying Credentials...';
    submitBtn.disabled = true;

    // Grab credentials from the admin form
    const payload = {
        email: document.getElementById('admin-email').value,
        password: document.getElementById('admin-password').value
    };

    try {
        // Notice the port is 5002 and we hit the specific admin login endpoint
        const res = await fetch('http://127.0.0.1:5002/api/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json();

        if (res.ok) {
            // Save token securely
            localStorage.setItem('token', data.token);

            // Extract and save the admin role
            const userRole = data.user?.role || data.role;
            if (userRole) {
                localStorage.setItem('role', userRole);
            }

            // Final check just in case, then redirect
            if (userRole === 'admin') {
                console.log("🎩 Admin Verified. Redirecting to Command Center...");
                window.location.href = 'admin_panel.html';
            } else {
                // Failsafe intercept
                errorDiv.innerText = 'System Error: Invalid role assignment.';
                submitBtn.innerHTML = originalText;
                submitBtn.disabled = false;
            }
        } else {
            // Display the 403 or 400 error message from your backend
            errorDiv.innerText = data.msg || 'Admin authentication failed.';
            submitBtn.innerHTML = originalText;
            submitBtn.disabled = false;
        }
    } catch (err) {
        errorDiv.innerText = "Server Error: " + (err.message ? err.message : 'Is port 5002 running?');
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
    }
}