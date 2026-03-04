// --- WORKSPACE & BILLING MANAGEMENT ---
console.info('🤝 [WORKSPACES] dashboard-workspaces.js loaded.');

async function shareStorage() {
    console.log('📨 [WORKSPACES] Share storage (invite) triggered.');
    const emailInput = document.getElementById('shareEmailInput');
    const email = emailInput.value.trim();
    const wsSelector = document.getElementById('inviteWorkspaceSelect');
    const selectedWsId = wsSelector.value;

    if (!selectedWsId) {
        console.warn('⚠️ [WORKSPACES] Invite aborted: No workspace selected.');
        return alert("Please select a target workspace folder from the dropdown.");
    }
    if (!email) {
        console.warn('⚠️ [WORKSPACES] Invite aborted: No email entered.');
        return alert("Please enter the team member's email address.");
    }

    console.log(`[WORKSPACES] Sending invite to ${email} for workspace ${selectedWsId}...`);
    try {
        const res = await fetch('http://127.0.0.1:5001/api/subscription/share', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({ emailToShare: email, workspaceId: selectedWsId })
        });

        const data = await res.json();

        if (res.ok) {
            console.log('✅ [WORKSPACES] Invite sent successfully!', data);
            alert(`✅ Success: Invitation sent to ${email}`);
            emailInput.value = '';
            fetchMasterData();
        } else {
            console.error('❌ [WORKSPACES] Server rejected invite:', data);
            alert("❌ Invitation failed: " + data.msg);
        }
    } catch (err) {
        console.error("💥 [WORKSPACES] Invite System Network Error:", err);
        alert("Network Error: Check if the backend server is running.");
    }
}

async function acceptInvite(inviteId) {
    console.log(`[WORKSPACES] Accepting invite ID: ${inviteId}`);
    try {
        const res = await fetch(`http://127.0.0.1:5001/api/subscription/accept-invite/${inviteId}`, {
            method: 'POST',
            headers: authHeaders
        });
        if (res.ok) {
            console.log('✅ [WORKSPACES] Invite accepted successfully.');
            alert("✅ Successfully joined workspace!");
            fetchMasterData();
        } else {
            console.error(`❌ [WORKSPACES] Failed to accept invite. Status: ${res.status}`);
        }
    } catch (err) {
        console.error("💥 [WORKSPACES] Accept Invite Error:", err);
        alert("Network Error");
    }
}

async function rejectInvite(inviteId) {
    console.log(`[WORKSPACES] Rejecting invite ID: ${inviteId}`);
    if (!confirm("Are you sure you want to decline this workspace invitation?")) return;
    try {
        const res = await fetch(`http://127.0.0.1:5001/api/subscription/reject-invite/${inviteId}`, {
            method: 'POST',
            headers: authHeaders
        });
        if (res.ok) {
            console.log('✅ [WORKSPACES] Invite rejected successfully.');
            alert("✅ Invitation declined.");
            fetchMasterData();
        } else {
            const data = await res.json();
            console.error('❌ [WORKSPACES] Failed to reject invite:', data);
            alert("❌ Failed to reject: " + (data.msg || "Unknown error"));
        }
    } catch (err) {
        console.error("💥 [WORKSPACES] Reject Invite Error:", err);
        alert("Error connecting to server.");
    }
}

async function revokeInvite(inviteId) {
    console.log(`[WORKSPACES] Revoking invite ID: ${inviteId}`);
    if (!confirm("Are you sure you want to cancel this invitation?")) return;
    try {
        const res = await fetch(`http://127.0.0.1:5001/api/subscription/revoke-invite/${inviteId}`, {
            method: 'DELETE',
            headers: authHeaders
        });
        const data = await res.json();
        if (res.ok) {
            console.log('✅ [WORKSPACES] Invite revoked.');
            alert("✅ " + data.msg);
            fetchMasterData();
        } else {
            console.error('❌ [WORKSPACES] Failed to revoke invite:', data);
            alert("❌ " + data.msg);
        }
    } catch (err) {
        console.error("💥 [WORKSPACES] Revoke Invite Error:", err);
        alert("Network Error: Could not connect to server.");
    }
}

async function submitNewWorkspace() {
    console.log('🏗️ [WORKSPACES] Creating new workspace...');
    const nameInput = document.getElementById('wsName');
    const name = nameInput.value;
    const gb = document.getElementById('wsStorageSlider').value;
    const msgDiv = document.getElementById('wsCreateMessage');

    if (!name) {
        console.warn('⚠️ [WORKSPACES] Workspace creation aborted: No name provided.');
        return alert("Enter a name");
    }

    msgDiv.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating...';

    try {
        const res = await fetch('http://127.0.0.1:5001/api/subscription/workspaces', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({ name: name.trim(), allocateGB: gb })
        });
        const data = await res.json();

        if (res.ok) {
            console.log('✅ [WORKSPACES] Workspace created successfully!', data);
            alert("✅ Workspace Created!");
            closeWorkspaceModal();
            nameInput.value = '';
            msgDiv.innerHTML = '';
            fetchMasterData();
        } else {
            console.error('❌ [WORKSPACES] Server rejected workspace creation:', data);
            msgDiv.innerHTML = `<span style="color:var(--danger); font-weight:600;"><i class="fa-solid fa-circle-exclamation"></i> ${data.msg}</span>`;
        }
    } catch (err) {
        console.error("💥 [WORKSPACES] Create Workspace Error:", err);
        msgDiv.innerHTML = `<span style="color:var(--danger)">Network Error</span>`;
    }
}

async function openWorkspaceModal() {
    console.log('🪟 [WORKSPACES] Opening Create Workspace modal and fetching fresh quota...');
    const modal = document.getElementById('createWorkspaceModal');
    const availableText = document.getElementById('wsAvailableText');
    const slider = document.getElementById('wsStorageSlider');

    try {
        const res = await fetch('http://127.0.0.1:5001/api/subscription/status', {
            headers: { 'x-auth-token': localStorage.getItem('token') }
        });
        const data = await res.json();

        const alreadyAllocated = data.workspacesCreated.reduce((acc, ws) => acc + ws.allocatedBytes, 0);
        const remainingGB = Math.max(0, (data.limit - alreadyAllocated) / (1024 * 1024 * 1024));

        slider.max = Math.floor(remainingGB);
        slider.value = Math.min(5, Math.floor(remainingGB));
        document.getElementById('wsStorageValue').innerText = slider.value + " GB";
        availableText.innerHTML = `<i class="fa-solid fa-chart-pie"></i> Remaining Quota: <strong>${remainingGB.toFixed(2)} GB</strong>`;

        modal.style.display = 'flex';
        console.log(`✅ [WORKSPACES] Modal populated. Remaining quota: ${remainingGB.toFixed(2)} GB`);
    } catch (err) {
        console.error("💥 [WORKSPACES] Error fetching quota for modal:", err);
    }
}

async function deleteOwnedWorkspace() {
    console.log(`🗑️ [WORKSPACES] Attempting to delete workspace ID: ${currentWorkspaceId}`);
    if (!currentWorkspaceId) return alert("Error: No workspace selected.");
    if (!confirm("CRITICAL: Permanently delete this workspace and reclaim your GBs?")) return;

    try {
        const res = await fetch(`http://127.0.0.1:5001/api/subscription/workspaces/${currentWorkspaceId}`, {
            method: 'DELETE',
            headers: { 'x-auth-token': localStorage.getItem('token'), 'Content-Type': 'application/json' }
        });
        const data = await res.json();

        if (res.ok) {
            console.log('✅ [WORKSPACES] Workspace deleted successfully.');
            alert("✅ Success: " + data.msg);
            switchTab('workspaces');
            fetchMasterData();
        } else {
            console.error('❌ [WORKSPACES] Failed to delete workspace:', data);
            alert("❌ Failed: " + data.msg);
        }
    } catch (err) {
        console.error("💥 [WORKSPACES] Delete Workspace Error:", err);
        alert("❌ Network Error: Could not reach server.");
    }
}

async function leaveCurrentWorkspace() {
    console.log(`🚶 [WORKSPACES] Attempting to leave workspace ID: ${currentWorkspaceId}`);
    if (!confirm("Are you sure you want to leave this team workspace? You will need a new invite to rejoin.")) return;

    try {
        const res = await fetch(`http://127.0.0.1:5001/api/subscription/leave-workspace/${currentWorkspaceId}`, {
            method: 'POST',
            headers: authHeaders
        });
        const data = await res.json();

        if (res.ok) {
            console.log('✅ [WORKSPACES] Successfully left workspace.');
            alert("✅ " + data.msg);
            switchTab('workspaces');
            fetchMasterData();
        } else {
            console.error('❌ [WORKSPACES] Failed to leave workspace:', data);
            alert("❌ Error: " + data.msg);
        }
    } catch (err) {
        console.error("💥 [WORKSPACES] Leave Workspace Error:", err);
        alert("❌ Network Error: Could not contact server.");
    }
}

async function redirectToStripe(planName) {
    console.log(`💳 [WORKSPACES] Initiating Stripe checkout for plan: ${planName}`);
    try {
        const res = await fetch('http://127.0.0.1:5001/api/subscription/create-checkout', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({ plan: planName })
        });
        const session = await res.json();
        console.log('✅ [WORKSPACES] Stripe session created, redirecting...', session.id);

        const stripe = Stripe('pk_test_51T5fH0GpYkDBDjPdFyxefQPFcBVvaXwrKCgCD7qps9zwGlOWlxXx1Ov8nqNMduSPCech45P2zjiIcthGFYn5gPfa001BlMPhLG');
        await stripe.redirectToCheckout({ sessionId: session.id });
    } catch (err) {
        console.error("💥 [WORKSPACES] Stripe Checkout Error:", err);
        alert("Payment Error: " + err.message);
    }
}