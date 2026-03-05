// --- FILE OPERATIONS ---
console.info('📁 [FILES] dashboard-files.js loaded.');

// Cache to hold file data for the NLP modal
window.fileDataCache = {};

async function loadFiles(driveId, targetBodyId) {
    console.log(`📥 [FILES] Fetching file list for drive: ${driveId} -> Target UI: ${targetBodyId}`);
    const listBody = document.getElementById(targetBodyId);
    try {
        const res = await fetch(`http://127.0.0.1:5002/api/storage/files?drive=${driveId}`, {
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

        // 🧠 NEW: Save files to cache for the NLP Modal
        files.forEach(f => window.fileDataCache[f._id] = f);

        listBody.innerHTML = files.map(file => {
            // Check if this file has compliance data
            const hasReport = file.complianceStatus === 'clean' || file.complianceStatus === 'redacted';
            const reportBtnHtml = hasReport ? `
                <button class="action-btn" style="background:var(--primary)" onclick="showNlpReport('${file._id}')" title="View Compliance Report">
                    <i class="fa-solid fa-shield-halved"></i>
                </button>
            ` : '';

            return ` 
            <tr> 
                <td>
                    <i class="fa-solid fa-file-lines" style="color: ${file.complianceStatus === 'redacted' ? '#ef4444' : 'inherit'}"></i> 
                    ${file.fileName}
                    ${file.complianceStatus === 'redacted' ? '<span style="font-size:0.7rem; background:#fee2e2; color:#ef4444; padding:2px 6px; border-radius:10px; margin-left:5px;">Redacted</span>' : ''}
                </td> 
                <td><i class="fa-solid fa-user-pen"></i> ${file.uploadedBy?.username || 'Unknown'}</td> 
                <td>${(file.fileSize / 1024).toFixed(2)} KB</td> 
                <td style="text-align: right; display: flex; justify-content: flex-end; gap: 5px;"> 
                    ${reportBtnHtml} <button class="action-btn" style="background:var(--success)" onclick="downloadFile('${file._id}', '${file.fileName}', this)">
                        <i class="fa-solid fa-download"></i>
                    </button> 
                    <button class="action-btn" style="background:var(--danger)" onclick="deleteFile('${file._id}', '${driveId}', '${targetBodyId}')">
                        <i class="fa-solid fa-trash-can"></i>
                    </button> 
                </td> 
            </tr>`;
        }).join('');
    } catch (err) {
        console.error("💥 [FILES] File Load Error:", err);
    }
}

async function handleUpload(e, driveId) {
    e.preventDefault();
    console.log(`📤 [FILES] Upload triggered for drive: ${driveId}`);
    const isWs = driveId !== 'personal';
    const input = document.getElementById(isWs ? 'fileInputWorkspace' : 'fileInputPersonal');
    const btn = document.getElementById(isWs ? 'btnUploadWorkspace' : 'btnUploadPersonal');

    if (!input.files[0]) {
        console.warn('⚠️ [FILES] Upload aborted: No file selected.');
        return;
    }

    console.log(`[FILES] Preparing to upload file: ${input.files[0].name}`);
    const originalBtnText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Encrypting & Uploading...';
    btn.disabled = true;

    const formData = new FormData();
    // 🧠 1. Append the NLP Checkbox state FIRST
    const checkboxId = isWs ? 'scanPiiWorkspace' : 'scanPiiPersonal';
    const scanCheckbox = document.getElementById(checkboxId);

    if (scanCheckbox && scanCheckbox.checked) {
        console.log("🛡️ [FILES] NLP Compliance Scan requested for this upload.");
        formData.append('scanPii', 'true');
    }

    // 🧠 2. Append the file LAST
    formData.append('file', input.files[0]);

    try {
        const res = await fetch(`http://127.0.0.1:5002/api/storage/upload?drive=${driveId}`, {
            method: 'POST',
            headers: { 'x-auth-token': token },
            body: formData
        });

        const data = await res.json();

        if (res.ok) {
            console.log('✅ [FILES] Upload successful!', data);
            alert("✅ Encryption Successful: File stored securely in AWS S3");
            fetchMasterData();
            loadFiles(driveId, isWs ? 'fileListWorkspace' : 'fileListPersonal');
            e.target.reset();
            document.getElementById(isWs ? 'fileNameWorkspace' : 'fileNamePersonal').innerText = '';
        } else {
            console.error('❌ [FILES] Server rejected upload:', data);
            alert("❌ Upload Failed: " + (data.msg || "Unknown error"));
        }
    } catch (err) {
        console.error("💥 [FILES] Upload Network Error:", err);
        alert("❌ Network Error: Could not connect to the encryption server.");
    } finally {
        btn.innerHTML = originalBtnText;
        btn.disabled = false;
    }
}

async function deleteFile(id, driveId, targetBodyId) {
    console.log(`🗑️ [FILES] Delete requested for file ID: ${id} on drive: ${driveId}`);
    if (!confirm("Are you sure you want to permanently remove this encrypted file?")) {
        console.log('🚫 [FILES] Delete cancelled by user.');
        return;
    }

    try {
        const res = await fetch(`http://127.0.0.1:5002/api/storage/files/${id}`, {
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
            console.error('❌ [FILES] Delete failed on server:', data);
            alert("❌ Delete Failed: " + (data.msg || "Unknown error"));
        }
    } catch (err) {
        console.error("💥 [FILES] Delete Network Error:", err);
        alert("❌ Network Error while removing file");
    }
}

async function downloadFile(id, name, btnElement) {
    console.log(`⬇️ [FILES] Download requested for file ID: ${id} | Name: ${name}`);
    const originalContent = btnElement.innerHTML;
    btnElement.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    btnElement.disabled = true;

    try {
        const res = await fetch(`http://127.0.0.1:5002/api/storage/download/${id}`, {
            headers: { 'x-auth-token': token }
        });

        if (!res.ok) {
            console.error(`❌ [FILES] Download failed with status: ${res.status}`);
            throw new Error("Download failed");
        }

        console.log('✅ [FILES] Blob received, triggering browser download...');
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = window.URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();

        window.URL.revokeObjectURL(a.href);
        document.body.removeChild(a);
        console.log(`🎉 [FILES] Download complete for: ${name}`);
    } catch (err) {
        console.error("💥 [FILES] Download Error:", err);
        alert("❌ Failed to download file from secure storage.");
    } finally {
        btnElement.innerHTML = originalContent;
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