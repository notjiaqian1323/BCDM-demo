// Check for existing session (Removed Admin routing)
const savedToken = localStorage.getItem('token');
const currentPage = window.location.pathname.split('/').pop();

// Only auto-redirect if sitting on the login page to prevent infinite loops
if (savedToken && (currentPage === 'login.html' || currentPage === '' || currentPage === '/')) {
    window.location.href = 'dashboard.html';
}

// Redirect to Admin Login Page via Button Click
const adminRedirectBtn = document.getElementById('admin-redirect-btn');
if (adminRedirectBtn) {
    adminRedirectBtn.addEventListener('click', () => {
        window.location.href = 'admin_login.html';
    });
}

function switchForm(form) {
    document.getElementById('error-message').innerText = '';
    if (form === 'login') {
        document.getElementById('login-form').style.display = 'block';
        document.getElementById('register-form').style.display = 'none';
        document.getElementById('btn-login').classList.add('active');
        document.getElementById('btn-register').classList.remove('active');
    } else {
        document.getElementById('login-form').style.display = 'none';
        document.getElementById('register-form').style.display = 'block';
        document.getElementById('btn-login').classList.remove('active');
        document.getElementById('btn-register').classList.add('active');
    }
}

async function handleAuth(e, type) {
    e.preventDefault();
    const errorDiv = document.getElementById('error-message');
    errorDiv.innerText = '';

    const submitBtn = type === 'login' ? document.getElementById('login-submit') : document.getElementById('reg-submit');
    const originalText = submitBtn.innerText;

    // UI feedback during processing
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processing...';
    submitBtn.disabled = true;

    const endpoint = type === 'login' ? '/api/auth/login' : '/api/auth/register';

    const payload = type === 'login'
        ? { email: document.getElementById('login-email').value, password: document.getElementById('login-password').value }
        : { username: document.getElementById('reg-username').value, email: document.getElementById('reg-email').value, password: document.getElementById('reg-password').value };

    try {
        // Notice I kept your updated port 5002 here!
        const res = await fetch(`http://127.0.0.1:5001${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json();

        if (res.ok) {
            // Save token
            localStorage.setItem('token', data.token);

            const userRole = data.user?.role || data.role;
            if (userRole) {
                localStorage.setItem('role', userRole);
            }

            // Standard User Redirect (All Admin logic completely removed)
            console.log("👤 Welcome User. Redirecting to Dashboard...");
            window.location.href = 'dashboard.html';

        } else {
            errorDiv.innerText = data.msg || 'Authentication failed';
            submitBtn.innerHTML = originalText;
            submitBtn.disabled = false;
        }
    } catch (err) {
        errorDiv.innerText = "Server Error" + (err.message ? `: ${err.message}` : '');
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
    }
}