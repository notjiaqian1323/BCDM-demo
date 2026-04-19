console.info('📁 [FILES] dashboard-files.js loaded.');

// Cache to hold file data for the NLP modal
window.fileDataCache = {};

// --- MULTI-UPLOAD QUEUE STATE ---
let uploadQueues = {
    personal: [],
    workspace: []
};

// 1. Handles adding files to the queue when selected
function handleFileSelection(event, type) {
    const files = Array.from(event.target.files);

    // Append new files to the existing queue
    uploadQueues[type] = [...uploadQueues[type], ...files];

    // Draw the updated list on the screen
    renderQueue(type);

    // Reset the input value so the browser allows selecting the exact same file again if they remove and re-add it
    event.target.value = '';
}

// 3. Renders the HTML list
function renderQueue(type) {
    const queueListId = type === 'personal' ? 'queueListPersonal' : 'queueListWorkspace';
    const queueList = document.getElementById(queueListId);
    const queue = uploadQueues[type];

    if (queue.length > 0) {
        queueList.innerHTML = queue.map((file, index) => `
            <li style="background: rgba(0,0,0,0.2); padding: 8px 12px; border-radius: 4px; margin-bottom: 5px; display: flex; justify-content: space-between; align-items: center; border: 1px solid var(--border);">
                <span id="queue-text-${type}-${index}" style="font-size: 0.85rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-main);">
                    <i class="fa-solid fa-file" style="margin-right: 8px; color: #94a3b8;"></i> ${file.name}
                </span>
                <i class="fa-solid fa-circle-xmark" style="cursor:pointer; color: var(--accent-red); margin-left: 10px;" onclick="removeFileFromQueue(event, ${index}, '${type}')" title="Remove"></i>
            </li>
        `).join('');
    } else {
        queueList.innerHTML = ''; // Clear the list if empty
    }
}

// 2. Handles removing a specific file from the queue
function removeFileFromQueue(event, index, type) {
    // 🛡️ THE FIX: This stops the click from triggering the file upload popup
    event.stopPropagation();
    event.preventDefault();

    // Remove the file and re-draw the list
    uploadQueues[type].splice(index, 1);
    renderQueue(type);
}

async function loadFiles(driveId, targetBodyId) {
    console.log(`📥 [FILES] Fetching file list for drive: ${driveId} -> Target UI: ${targetBodyId}`);
    const listBody = document.getElementById(targetBodyId);
    try {
        const res = await fetch(`http://127.0.0.1:5001/api/storage/files?drive=${driveId}`, {
            headers: { 'x-auth-token': token }
        });
        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`Server failed with status ${res.status}: ${errorText}`);
        }

        const files = await res.json();
        console.log(`✅ [FILES] Received ${files.length} files from server.`);

        if (files.length === 0) {
            listBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px;">No files found in this workspace.</td></tr>';
            return;
        }

        // 🧠 Save files to cache for the NLP Modal
        files.forEach(f => window.fileDataCache[f._id] = f);

        listBody.innerHTML = files.map(file => {
            // --- 1. UI STATE LOGIC (Updated for HITL) ---
            const isScanning = file.complianceStatus === 'scanning';
            const isRejected = file.complianceStatus === 'rejected';
            const isRedacted = file.complianceStatus === 'redacted';
            const isAwaitingReview = file.complianceStatus === 'awaiting_review'; // 🛡️ NEW STATE

            // Files awaiting review cannot be downloaded yet
            const isQuarantined = isScanning || isRejected || isAwaitingReview;
            const hasReport = file.complianceStatus === 'clean' || isRedacted;

            // --- 2. STATUS BADGES ---
            let statusBadge = '';
            if (isAwaitingReview) statusBadge = '<span style="font-size:0.7rem; background:#fef08a; color:#854d0e; padding:2px 6px; border-radius:10px; margin-left:5px;"><i class="fa-solid fa-triangle-exclamation"></i> Action Required</span>';
            else if (isRedacted) statusBadge = '<span style="font-size:0.7rem; background:#fee2e2; color:#ef4444; padding:2px 6px; border-radius:10px; margin-left:5px;">Redacted</span>';
            else if (isScanning) statusBadge = '<span style="font-size:0.7rem; background:#e0f2fe; color:#0284c7; padding:2px 6px; border-radius:10px; margin-left:5px;"><i class="fa-solid fa-spinner fa-spin"></i> Scanning</span>';
            else if (isRejected) statusBadge = '<span style="font-size:0.7rem; background:#fef2f2; color:#991b1b; padding:2px 6px; border-radius:10px; margin-left:5px;"><i class="fa-solid fa-ban"></i> Rejected</span>';

            // --- 3. BUTTON CONTROLS ---

            // A. The Review / Report Button
            let actionBtnHtml = '';
            if (isAwaitingReview) {
                // Encode the file object to pass it safely to the modal
                const encodedFile = encodeURIComponent(JSON.stringify(file));
                actionBtnHtml = `
                    <button class="action-btn pulse" style="background: var(--warning); color: #000;" onclick="openReviewModal('${encodedFile}')" title="Action Required: Review Findings">
                        <i class="fa-solid fa-user-shield"></i>
                    </button>
                `;
            } else if (hasReport) {
                actionBtnHtml = `
                    <button class="action-btn" style="background:var(--primary)" onclick="showNlpReport('${file._id}')" title="View Compliance Report">
                        <i class="fa-solid fa-shield-halved"></i>
                    </button>
                `;
            }

            // B. The Download Button
            let downloadReason = isScanning ? 'currently scanning' : (isAwaitingReview ? 'awaiting privacy review' : 'rejected for policy violations');
            const downloadBtnHtml = `
                <button class="action-btn" 
                    style="background: ${isQuarantined ? '#cbd5e1' : 'var(--success)'}; cursor: ${isQuarantined ? 'not-allowed' : 'pointer'};" 
                    onclick="${isQuarantined ? `alert('Download disabled: File is ${downloadReason}.')` : `downloadFile('${file._id}', '${file.fileName}', this)`}"
                    ${isQuarantined ? 'disabled' : ''} title="Download File">
                    <i class="fa-solid ${isScanning ? 'fa-hourglass-half' : (isRejected ? 'fa-lock' : 'fa-download')}"></i>
                </button>
            `;

            // C. The Delete Button
            const deleteBtnHtml = `
                <button class="action-btn" 
                    style="background: ${isScanning ? '#cbd5e1' : 'var(--danger)'}; cursor: ${isScanning ? 'not-allowed' : 'pointer'};" 
                    onclick="${isScanning ? `alert('Please wait for the AI scan to finish before deleting.')` : `deleteFile('${file._id}', '${driveId}', '${targetBodyId}')`}"
                    ${isScanning ? 'disabled' : ''} title="Delete File">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            `;

            // --- 4. BLOCKCHAIN INTEGRITY BADGE ---
            const hasBlockchainRecord = file.blockchainIndex !== undefined;
            const integrityShieldHtml = hasBlockchainRecord ? `
                <span id="status-${file._id}" 
                      style="font-size: 0.7rem; font-weight: bold; cursor: pointer; margin-left: 8px; color: #64748b;" 
                      onclick="verifyFileIntegrity('${file._id}', false)">
                      <i class="fa-solid fa-circle-notch fa-spin"></i> Pending...
                </span>
            ` : '<span style="font-size: 0.7rem; color: #94a3b8; margin-left: 8px;">(No Ledger)</span>';

            // --- 5. RENDER ROW ---
            return ` 
            <tr> 
                <td>
                    <i class="fa-solid fa-file-lines" style="color: ${isRedacted || isRejected ? '#ef4444' : 'inherit'}"></i> 
                    ${file.fileName}
                    ${integrityShieldHtml}
                    ${statusBadge}
                </td> 
                <td><i class="fa-solid fa-user-pen"></i> ${file.uploadedBy?.username || 'Unknown'}</td> 
                <td>${(file.fileSize / 1024).toFixed(2)} KB</td> 
                <td style="text-align: right; display: flex; justify-content: flex-end; gap: 5px;"> 
                    ${actionBtnHtml}
                    ${downloadBtnHtml}
                    ${deleteBtnHtml}
                </td> 
            </tr>`;
        }).join('');

        // 🚀 NEW: Automated Integrity Check Loop
        // We wait a tiny bit for the DOM to settle, then verify each file
        files.forEach((file, index) => {
            if (file.blockchainIndex !== undefined) {
                // We call the manual function but tell it to be SILENT (no alerts)
                setTimeout(() => verifyFileIntegrity(file._id, true), index * 200);
            }
        });

    } catch (err) {
        console.error("💥 [FILES] File Load Error:", err);
    }
}

// 🛡️ Helper function for the background check
async function autoVerifyIntegrity(fileId) {
    const shield = document.getElementById(`shield-${fileId}`);
    if (!shield) return;

    // Optional: Add a subtle pulse to show it's "thinking"
    shield.classList.add('fa-fade');

    try {
        const res = await fetch(`http://127.0.0.1:5001/api/storage/verify/${fileId}`, {
            headers: { 'x-auth-token': token }
        });
        const data = await res.json();

        shield.classList.remove('fa-fade', 'text-secondary');

        if (data.authentic) {
            shield.className = "fa-solid fa-shield-check text-success";
            shield.title = "Integrity Verified via Blockchain";
        } else {
            shield.className = "fa-solid fa-shield-xmark text-danger fa-beat";
            shield.title = "ALERT: Data Mismatch Detected!";
            // Optional: Log it to a central security log
            console.error(`🚨 Security Alert: Integrity failure for file ${fileId}`);
        }

        // --- 🛡️ CONTINUOUS INTEGRITY HEARTBEAT ---
        // 1. Clear any existing heartbeat to prevent memory leaks
        if (window.integrityHeartbeat) clearInterval(window.integrityHeartbeat);

        // 2. Start the new heartbeat
        window.integrityHeartbeat = setInterval(() => {
            console.log("💓 [HEARTBEAT] Verifying all active files...");
            files.forEach((file, index) => {
                if (file.blockchainIndex !== undefined) {
                    // Stagger the checks so we don't spam the server all at once
                    setTimeout(() => verifyFileIntegrity(file._id, true), index * 150);
                }
            });
        }, 10000); // Check every 10 seconds (adjust for your demo)

    } catch (err) {
        shield.className = "fa-solid fa-shield-slash text-muted";
        console.warn(`⚠️ Could not verify file ${fileId}: ${err.message}`);
    }
}

// --- 1. BATCH MANAGER ---
async function handleUpload(e, driveId) {
    e.preventDefault();
    const isWs = driveId !== 'personal';
    const queueType = isWs ? 'workspace' : 'personal';
    const queue = uploadQueues[queueType];
    const btn = document.getElementById(isWs ? 'btnUploadWorkspace' : 'btnUploadPersonal');

    // Prevent empty uploads
    if (!queue || queue.length === 0) {
        alert("⚠️ Please select at least one file to upload.");
        return;
    }

    const originalBtnText = btn.innerHTML;
    btn.disabled = true;

    try {
        console.log(`[BATCH UPLOAD] Starting concurrent upload for ${queue.length} files...`);
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Initializing Batch...`;

        // 🚀 Create an array of active XHR upload promises
        const uploadPromises = queue.map((file, index) => {
            return processSingleUpload(file, driveId, isWs, index, queueType);
        });

        // 🛡️ Use allSettled so if ONE file fails (e.g., too big), the others still upload
        const results = await Promise.allSettled(uploadPromises);

        // Check for any failures in the batch
        const failed = results.filter(r => r.status === 'rejected');
        if (failed.length > 0) {
            alert(`⚠️ ${failed.length} out of ${queue.length} files failed. Check console for details.`);
        } else {
            alert(`✅ Successfully encrypted and secured all ${queue.length} files!`);
        }

        // Clean up UI and refresh tables
        uploadQueues[queueType] = [];
        renderQueue(queueType); // Clears the visual list
        await fetchMasterData();
        await loadFiles(driveId, isWs ? 'fileListWorkspace' : 'fileListPersonal');

    } catch (err) {
        console.error("💥 [BATCH UPLOAD] Critical Error:", err);
        alert("❌ A critical error occurred during the batch upload.");
    } finally {
        btn.innerHTML = originalBtnText;
        btn.disabled = false;
    }
}

// --- 2. THE WORKER (Your customized XHR logic) ---
async function processSingleUpload(file, driveId, isWs, index, queueType) {
    // 🛡️ 1. Instant Client-Side Size Check (10MB limit per file)
    const MAX_MB = 10;
    if (file.size > MAX_MB * 1024 * 1024) {
        updateQueueUI(queueType, index, `<i class="fa-solid fa-triangle-exclamation text-red"></i> ${file.name} (Too Large)`);
        throw new Error(`File ${file.name} exceeds ${MAX_MB}MB.`);
    }

    const formData = new FormData();
    const checkboxId = isWs ? 'scanPiiWorkspace' : 'scanPiiPersonal';
    const scanCheckbox = document.getElementById(checkboxId);

    if (scanCheckbox && scanCheckbox.checked) {
        formData.append('scanPii', 'true');
    }
    formData.append('file', file);

    // 🧠 2. Use XHR wrapped in a Promise
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `http://127.0.0.1:5001/api/storage/upload?drive=${driveId}`);
        xhr.setRequestHeader('x-auth-token', token);

        // 🚀 Live Progress Tracking per File
        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
                const percentComplete = Math.round((event.loaded / event.total) * 100);

                if (percentComplete < 100) {
                    updateQueueUI(queueType, index, `<i class="fa-solid fa-spinner fa-spin" style="color: #3b82f6;"></i> ${file.name} (${percentComplete}%)`);
                } else {
                    updateQueueUI(queueType, index, `<i class="fa-solid fa-link fa-fade" style="color: #8b5cf6;"></i> ${file.name} (Securing on Chain...)`);
                }
            }
        };

        xhr.onload = () => {
            try {
                const data = JSON.parse(xhr.responseText);
                if (xhr.status >= 200 && xhr.status < 300) {
                    updateQueueUI(queueType, index, `<i class="fa-solid fa-check" style="color: #10b981;"></i> ${file.name} (Secured)`);
                    resolve({ ok: true, data });
                } else {
                    updateQueueUI(queueType, index, `<i class="fa-solid fa-xmark" style="color: #ef4444;"></i> ${file.name} (Failed)`);
                    reject(new Error(data.msg || "Server rejected upload"));
                }
            } catch (err) {
                reject(new Error("Failed to parse server response"));
            }
        };

        xhr.onerror = () => {
            updateQueueUI(queueType, index, `<i class="fa-solid fa-wifi" style="color: #ef4444;"></i> ${file.name} (Network Error)`);
            reject(new Error("Network Error"));
        };

        xhr.send(formData);
    });
}

// --- 3. UI HELPER ---
function updateQueueUI(queueType, index, htmlString) {
    const listItemText = document.getElementById(`queue-text-${queueType}-${index}`);
    if (listItemText) {
        listItemText.innerHTML = htmlString;
    }
}

async function deleteFile(id, driveId, targetBodyId) {
    console.log(`🗑️ [FILES] Delete requested for file ID: ${id} on drive: ${driveId}`);
    if (!confirm("Are you sure you want to permanently remove this encrypted file?")) {
        console.log('🚫 [FILES] Delete cancelled by user.');
        return;
    }

    try {
        const res = await fetch(`http://127.0.0.1:5001/api/storage/files/${id}`, {
            method: 'DELETE',
            headers: { 'x-auth-token': token }
        });
        if (res.ok) {
            console.log('✅ [FILES] Delete successful!');
            alert("✅ Remove Success: File purged from cloud storage");
            await loadFiles(driveId, targetBodyId);
            await fetchMasterData();
        } else {
            const data = await res.json();
            alert("❌ Delete Failed: " + (data.msg || "Unknown error"));
        }
    } catch (err) {
        console.error("💥 [FILES] Delete Network Error:", err);
        alert("❌ Network Error while removing file");
    }
}

async function downloadFile(fileId, fileName, btnElement) {
    // Optional: Make the button spin so the user knows it's working
    const originalIcon = btnElement.innerHTML;
    btnElement.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    btnElement.disabled = true;

    try {
        const res = await fetch(`http://127.0.0.1:5001/api/storage/download/${fileId}`, {
            headers: { 'x-auth-token': token }
        });

        // 🛡️ CRITICAL FIX: Check what the server actually sent back
        const contentType = res.headers.get("content-type");

        // IF IT'S AN ERROR (JSON)
        if (contentType && contentType.includes("application/json")) {
            const data = await res.json();
            btnElement.innerHTML = originalIcon;
            btnElement.disabled = false;
            return showToast(data.msg || "Download blocked by server.", "danger");
        }

        // IF IT FAILED FOR ANOTHER REASON
        if (!res.ok) {
            btnElement.innerHTML = originalIcon;
            btnElement.disabled = false;
            return showToast("Error connecting to storage server.", "danger");
        }

        // ✅ IF IT'S SUCCESSFUL (BINARY FILE)
        const blob = await res.blob(); // Convert the stream into a file object
        const url = window.URL.createObjectURL(blob);

        // Create an invisible link and click it to trigger the browser's "Save As"
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = fileName; // Force the correct filename
        document.body.appendChild(a);
        a.click();

        // Clean up
        window.URL.revokeObjectURL(url);
        a.remove();

        showToast(`✅ Download complete: ${fileName}`, "success");

    } catch (err) {
        console.error("Download Error:", err);
        showToast("Connection error during download", "danger");
    } finally {
        // Always reset the button
        btnElement.innerHTML = originalIcon;
        btnElement.disabled = false;
    }
}

// Function to populate and show the NLP Report Modal
window.showNlpReport = function(fileId) {
    const file = window.fileDataCache[fileId];
    if (!file) {
        alert("Report data not found in cache. Please refresh the page.");
        return;
    }

    // 1. Set Scores and Classification
    document.getElementById('modalRiskScore').innerText = file.riskScore !== undefined ? file.riskScore : 100;

    const classEl = document.getElementById('modalClassification');
    classEl.innerText = file.classification || 'PUBLIC';

    // Color coding the classification
    if (file.classification === 'RESTRICTED') classEl.style.color = '#ef4444';
    else if (file.classification === 'INTERNAL') classEl.style.color = '#f59e0b';
    else classEl.style.color = '#10b981';

    // 2. Set Keywords
    const keywords = file.riskKeywords && file.riskKeywords.length > 0 ? file.riskKeywords.join(', ') : 'None detected';
    document.getElementById('modalKeywords').innerText = keywords;

    // 3. Set PII Redactions List
    const piiList = document.getElementById('modalPiiList');
    if (file.piiReport && file.piiReport.length > 0) {
        piiList.innerHTML = file.piiReport.map(pii => `
            <tr>
                <td style="padding: 8px; border-bottom: 1px solid var(--border); font-weight: 600;">${pii.type}</td>
                <td style="padding: 8px; border-bottom: 1px solid var(--border); font-family: monospace;">${pii.text}</td>
                <td style="padding: 8px; border-bottom: 1px solid var(--border); color: #ef4444;">Page ${pii.page}</td>
            </tr>
        `).join('');
    } else {
        piiList.innerHTML = '<tr><td style="padding: 15px; text-align: center; color: var(--text-muted);">No PII found in this document.</td></tr>';
    }

    // 4. Show the modal
    // Note: Assuming your modal CSS allows 'flex' for centering. If it looks weird, change 'flex' to 'block'
    document.getElementById('nlpReportModal').style.display = 'flex';
};

async function downloadComplianceReport() {
    const start = document.getElementById('auditStartDate').value;
    const end = document.getElementById('auditEndDate').value;

    if (!start || !end) return alert("Please select both a Start Date and an End Date.");
    if (new Date(start) > new Date(end)) return alert("Start Date cannot be after the End Date.");

    try {
        const queryStr = `?startDate=${start}&endDate=${end}`;
        const res = await fetch(`http://127.0.0.1:5001/api/reports/compliance-csv${queryStr}`, {
            headers: authHeaders
        });

        if (res.status === 403) {
            return alert("🔒 Access Denied: Compliance Audit Exports are strictly restricted to Enterprise plan users.");
        }
        if (!res.ok) throw new Error("Server error generating report.");

        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = `BCDS_Audit_${start}_to_${end}.csv`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
    } catch (err) {
        alert("❌ Failed to download report. Ensure server is running.");
    }
}

async function verifyFileIntegrity(fileId, isSilent = false) {
    const statusLabel = document.getElementById(`status-${fileId}`);
    if (!statusLabel) return;

    // 1. Processing State
    if (!isSilent) {
        statusLabel.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Verifying...`;
        statusLabel.style.color = "#f59e0b"; // Orange
    }

    try {
        const res = await fetch(`http://127.0.0.1:5001/api/storage/verify/${fileId}`, {
            headers: { 'x-auth-token': token }
        });
        const data = await res.json();

        if (data.authentic) {
            statusLabel.innerHTML = `<i class="fa-solid fa-check-double"></i> Blockchain Verified`;
            statusLabel.style.color = "#10b981";
            statusLabel.classList.remove('status-tampered');

            // Restore UI if it was previously tampered
            const row = statusLabel.closest('tr');
            row.classList.remove('row-compromised');
            // Re-enable download button logic here if needed
        } else {
            // 🚨 TAMPERED STATE
            statusLabel.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> TAMPERED`;
            statusLabel.classList.add('status-tampered');

            // 🛠️ Action: Lockdown the UI
            const row = statusLabel.closest('tr');
            row.classList.add('row-compromised');

            // Find the download button in this specific row and disable it
            const downloadBtn = row.querySelector('button[title="Download File"]');
            if (downloadBtn) {
                downloadBtn.style.background = "#cbd5e1";
                downloadBtn.style.cursor = "not-allowed";
                downloadBtn.disabled = true;
                downloadBtn.title = "Security Lock: Integrity Breach";
            }

            if (!isSilent) alert("🚨 SECURITY ALERT: This file has failed the blockchain integrity check and has been locked!");
        }
    } catch (err) {
        statusLabel.innerHTML = `Error`;
        statusLabel.style.color = "#64748b";
    }
}

function showToast(message, type = "success") {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast-msg toast-${type}`;
    toast.innerHTML = message;

    container.appendChild(toast);

    // Auto-remove after 4 seconds
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 500);
    }, 4000);
}

// --- 1. OPEN THE REVIEW MODAL ---
function openReviewModal(fileStr) {
    // We parse the stringified file object passed from the file list table
    const file = JSON.parse(decodeURIComponent(fileStr));

    document.getElementById('currentReviewFileId').value = file._id;
    document.getElementById('reviewFileName').innerText = file.fileName;
    document.getElementById('reviewRiskScore').innerText = file.riskScore || 100;
    document.getElementById('reviewClassification').innerText = file.classification || 'UNKNOWN';

    const list = document.getElementById('reviewPiiList');
    list.innerHTML = ''; // Clear previous

    if (!file.piiReport || file.piiReport.length === 0) {
        list.innerHTML = `<tr><td colspan="3" style="text-align:center; padding: 15px;">No entities found.</td></tr>`;
    } else {
        // Map over the PII report and create an interactive row for each item
        file.piiReport.forEach((item, index) => {
            // We use the exact text as the data-attribute so we can grab it later
            list.innerHTML += `
                <tr style="border-bottom: 1px solid var(--border);">
                    <td style="padding: 10px; font-weight: 600; color: var(--text-muted);">${item.type}</td>
                    <td style="padding: 10px; font-family: monospace; color: var(--danger);">${item.text}</td>
                    <td style="padding: 10px; text-align: center;">
                        <select class="decision-dropdown" data-text="${item.text}" style="padding: 5px; border-radius: 4px; border: 1px solid var(--border); outline: none;">
                            <option value="redact" selected>⬛ Redact (Blackout)</option>
                            <option value="keep">👁️ Keep Visible</option>
                        </select>
                    </td>
                </tr>
            `;
        });
    }

    // Show the modal
    document.getElementById('nlpReviewModal').style.display = 'flex';
}

// --- 2. SUBMIT THE DECISIONS ---
async function submitNlpReview() {
    const fileId = document.getElementById('currentReviewFileId').value;
    const btn = document.getElementById('btnCommitReview');
    const originalText = btn.innerHTML;

    // Gather all decisions from the dropdowns
    const dropdowns = document.querySelectorAll('.decision-dropdown');
    const decisions = Array.from(dropdowns).map(select => ({
        text: select.getAttribute('data-text'),
        action: select.value // 'redact' or 'keep'
    }));

    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Processing...`;
    btn.disabled = true;

    try {
        const res = await fetch(`http://127.0.0.1:5001/api/storage/nlp-commit/${fileId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-auth-token': token
            },
            body: JSON.stringify({ decisions })
        });

        const data = await res.json();

        if (res.ok) {
            showToast("Review submitted successfully! Processing final document...", "success");
            document.getElementById('nlpReviewModal').style.display = 'none';

            // Refresh the file list so the user sees the status change from "Awaiting Review" to "Scanning" or "Clean"
            const isPersonal = document.getElementById('personal-view').classList.contains('active');
            loadFiles(isPersonal ? 'personal' : currentWorkspaceId, isPersonal ? 'fileListPersonal' : 'fileListWorkspace');
        } else {
            showToast(data.msg || "Failed to commit review", "danger");
        }
    } catch (err) {
        console.error("Review Error:", err);
        showToast("Network error during submission.", "danger");
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}