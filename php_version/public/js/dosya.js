const state = {
    file: null,
    config: null,
    shareUrl: '',
};

document.addEventListener('DOMContentLoaded', async () => {
    bindUploader();
    bindResultActions();
    await loadConfig();
});

async function loadConfig() {
    try {
        const response = await fetch('/dosya/config');
        state.config = await response.json();
        const preferredFloor = formatBytes(state.config?.preferred_chunk_floor_bytes || 0);
        const botLimit = formatBytes(state.config?.telegram_bot_limit_bytes || 0);
        document.getElementById('dropMeta').textContent = `Limit alti dosyalar tek parca gider. Limit asilirsa sistem dosya boyutuna gore en uygun parcayi secer. Taban parca: ${preferredFloor}, bot limiti: ${botLimit}`;
        syncExpiryOptions();
    } catch (error) {
        document.getElementById('dropMeta').textContent = 'Yukleme plani bilgisi alinamadi ama yukleme devam edebilir.';
    }
}

function syncExpiryOptions() {
    const expirySelect = document.getElementById('expirySelect');
    const durations = state.config?.allowed_durations || {};
    if (!expirySelect || !durations || !Object.keys(durations).length) {
        return;
    }

    expirySelect.innerHTML = Object.entries(durations).map(([value, label]) => {
        const selected = String(value) === '1440' ? 'selected' : '';
        return `<option value="${value}" ${selected}>${label}</option>`;
    }).join('');
}

function bindUploader() {
    const fileInput = document.getElementById('fileInput');
    const dropzone = document.getElementById('dropzone');
    const uploadButton = document.getElementById('uploadButton');

    fileInput.addEventListener('change', (event) => {
        const [file] = event.target.files || [];
        setSelectedFile(file || null);
    });

    dropzone.addEventListener('dragover', (event) => {
        event.preventDefault();
        dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('dragover');
    });

    dropzone.addEventListener('drop', (event) => {
        event.preventDefault();
        dropzone.classList.remove('dragover');
        const [file] = event.dataTransfer.files || [];
        if (file) {
            document.getElementById('fileInput').files = event.dataTransfer.files;
            setSelectedFile(file);
        }
    });

    uploadButton.addEventListener('click', () => {
        if (state.file) {
            uploadSelectedFile();
        }
    });
}

function bindResultActions() {
    document.getElementById('copyLinkButton').addEventListener('click', async () => {
        if (!state.shareUrl) return;
        try {
            await navigator.clipboard.writeText(state.shareUrl);
            await toast('success', 'Link kopyalandi');
        } catch (error) {
            window.prompt('Linki kopyalayin:', state.shareUrl);
        }
    });

    document.getElementById('openLinkButton').addEventListener('click', () => {
        if (state.shareUrl) {
            window.open(state.shareUrl, '_blank', 'noopener');
        }
    });
}

function setSelectedFile(file) {
    state.file = file;
    const selectedCard = document.getElementById('selectedFileCard');
    const uploadPlanCard = document.getElementById('uploadPlanCard');
    if (!file) {
        selectedCard.classList.add('hidden');
        uploadPlanCard.classList.add('hidden');
        return;
    }

    selectedCard.classList.remove('hidden');
    uploadPlanCard.classList.remove('hidden');
    document.getElementById('selectedFileName').textContent = file.name;
    document.getElementById('selectedFileSize').textContent = formatBytes(file.size);
    renderEstimatedPlan(file);
}

async function uploadSelectedFile() {
    const file = state.file;
    if (!file) return;

    const uploadButton = document.getElementById('uploadButton');
    const progressCard = document.getElementById('progressCard');
    const progressFill = document.getElementById('progressFill');
    const progressText = document.getElementById('progressText');
    const progressFoot = document.getElementById('progressFoot');

    uploadButton.disabled = true;
    uploadButton.textContent = 'Yukleniyor...';
    progressCard.classList.remove('hidden');
    progressFill.style.width = '0%';
    progressText.textContent = '0%';
    progressFoot.textContent = 'Yukleme plani hazirlaniyor...';

    const expiresInMinutes = document.getElementById('expirySelect').value;
    const emailValue = (document.getElementById('notifyEmail').value || '').trim();

    try {
        const startPayload = {
            file_name: file.name,
            mime_type: file.type || 'application/octet-stream',
            file_size: file.size,
            expires_in_minutes: expiresInMinutes,
            notify_email: emailValue,
        };
        const startResult = await postJson('/dosya/upload/start', startPayload);
        const uploadId = startResult.upload_id;
        const chunkSize = Math.max(1, Number(startResult.chunk_size_bytes || file.size || 1));
        const chunkCount = Math.max(1, Number(startResult.chunk_count || 1));
        const isChunked = Boolean(startResult.is_chunked);

        renderConfirmedPlan(file, startResult);

        let uploadedBytes = 0;
        for (let partIndex = 0; partIndex < chunkCount; partIndex += 1) {
            const start = partIndex * chunkSize;
            const end = Math.min(file.size, start + chunkSize);
            const blob = file.slice(start, end);
            const uploadName = isChunked
                ? `${file.name}.part${String(partIndex + 1).padStart(3, '0')}`
                : file.name;
            const chunkFile = new File([blob], uploadName, { type: file.type || 'application/octet-stream' });
            const formData = new FormData();
            formData.append('upload_id', uploadId);
            formData.append('part_index', String(partIndex));
            formData.append('chunk', chunkFile);

            progressFoot.textContent = isChunked
                ? `Parca ${partIndex + 1}/${chunkCount} Telegram'a gonderiliyor...`
                : "Dosya dogrudan Telegram'a gonderiliyor...";
            await xhrUpload('/dosya/upload/chunk', formData);

            uploadedBytes += blob.size;
            const percent = Math.min(100, Math.round((uploadedBytes / file.size) * 100));
            progressFill.style.width = `${percent}%`;
            progressText.textContent = `${percent}%`;
        }

        progressFoot.textContent = 'Link olusturuluyor...';
        const result = await postJson('/dosya/upload/complete', { upload_id: uploadId });

        state.shareUrl = result.share_url || '';
        showResult(result);
        progressFill.style.width = '100%';
        progressText.textContent = '100%';
        progressFoot.textContent = result.is_chunked
            ? `Yukleme tamamlandi. Dosya ${result.chunk_count || 1} parcaya bolunerek saklandi.`
            : 'Yukleme tamamlandi. Dosya tek parca olarak saklandi.';
        await toast('success', 'Paylasim linki hazir');
    } catch (error) {
        progressFoot.textContent = error.message || 'Yukleme sirasinda hata olustu.';
        await Swal.fire({
            icon: 'error',
            title: 'Yukleme basarisiz',
            text: error.message || 'Dosya yuklenemedi.',
        });
    } finally {
        uploadButton.disabled = false;
        uploadButton.textContent = 'Link Olustur';
    }
}

function renderEstimatedPlan(file) {
    const plan = estimateUploadPlan(file.size);
    const title = document.getElementById('uploadPlanTitle');
    const chip = document.getElementById('uploadPlanChip');
    const meta = document.getElementById('uploadPlanMeta');
    const warning = document.getElementById('uploadPlanWarning');

    title.textContent = plan.isChunked
        ? 'Buyuk dosya algilandi, coklu parca ile gidecek'
        : 'Bu dosya tek parca yuklenecek';
    chip.textContent = plan.isChunked ? `${plan.chunkCount} parca` : 'Tek parca';
    meta.textContent = plan.isChunked
        ? `Tahmini parca boyutu ${formatBytes(plan.chunkSize)}. Indirirken sistem bu parcalari otomatik birlestirir.`
        : `Dosya boyutu limit icinde. Yaklasik ${formatBytes(file.size)} veri dogrudan Telegram'a gonderilecek.`;
    warning.textContent = plan.isChunked
        ? 'Uyari: Buyuk dosyalarda yukleme suresi daha uzun olabilir, tarayici sekmesini kapatma.'
        : 'Bilgi: Bu dosya bot limitini asmiyor, gereksiz parcaya bolunmeyecek.';
    warning.classList.toggle('is-caution', plan.isChunked);
    warning.classList.toggle('is-safe', !plan.isChunked);
}

function renderConfirmedPlan(file, result) {
    const chip = document.getElementById('uploadPlanChip');
    const meta = document.getElementById('uploadPlanMeta');
    const warning = document.getElementById('uploadPlanWarning');
    const isChunked = Boolean(result.is_chunked);
    const chunkCount = Math.max(1, Number(result.chunk_count || 1));
    const chunkSize = Math.max(1, Number(result.chunk_size_bytes || file.size || 1));

    chip.textContent = isChunked ? `${chunkCount} parca` : 'Tek parca';
    meta.textContent = isChunked
        ? `Sunucu plani onayladi: ${chunkCount} parca, parca boyutu yaklasik ${formatBytes(chunkSize)}.`
        : `Sunucu plani onayladi: dosya tek parca gidecek. Toplam boyut ${formatBytes(file.size)}.`;
    warning.textContent = isChunked
        ? 'Uyari: Parcalar sira ile yukleniyor. Baglanti kesilirse link olusmadan islem yarim kalir.'
        : 'Bilgi: Tek parca akisi kullaniliyor, indirme tarafinda ekstra birlestirme gerekmeyecek.';
    warning.classList.toggle('is-caution', isChunked);
    warning.classList.toggle('is-safe', !isChunked);
}

function estimateUploadPlan(fileSize) {
    const botLimit = Math.max(1, Number(state.config?.telegram_bot_limit_bytes || 45 * 1024 * 1024));
    const preferredFloor = Math.max(1, Number(state.config?.preferred_chunk_floor_bytes || 8 * 1024 * 1024));
    const safeChunkCeiling = Math.max(1, botLimit - (512 * 1024));

    if (fileSize <= botLimit) {
        return {
            isChunked: false,
            chunkCount: 1,
            chunkSize: fileSize,
        };
    }

    let chunkCount = Math.max(2, Math.ceil(fileSize / safeChunkCeiling));
    let chunkSize = Math.ceil(fileSize / chunkCount);
    chunkSize = Math.max(preferredFloor, Math.min(safeChunkCeiling, chunkSize));
    chunkCount = Math.max(2, Math.ceil(fileSize / chunkSize));

    return {
        isChunked: true,
        chunkCount,
        chunkSize,
    };
}

function showResult(result) {
    const panel = document.getElementById('resultPanel');
    panel.classList.remove('hidden');
    document.getElementById('chunkInfoChip').textContent = result.is_chunked
        ? `${result.chunk_count || 1} parca`
        : 'Tek parca';
    const link = document.getElementById('shareLinkText');
    link.href = result.share_url || '#';
    link.textContent = result.share_url || '-';
    document.getElementById('expiryText').textContent = result.expires_at
        ? `Link ${formatDateTime(result.expires_at)} tarihinde otomatik kapanir ve dosya silinir.`
        : 'Link suresiz.';

    // E-posta gönderim bilgisi
    const emailBadge = document.getElementById('emailSentBadge');
    if (result.email_sent && result.email_to) {
        document.getElementById('emailSentTo').textContent = result.email_to;
        emailBadge.classList.remove('hidden');
    } else {
        emailBadge.classList.add('hidden');
    }
}

function xhrUpload(url, formData, onProgress) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url, true);

        if (typeof onProgress === 'function') {
            xhr.upload.addEventListener('progress', (event) => {
                if (!event.lengthComputable) return;
                const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
                onProgress(percent);
            });
        }

        xhr.onload = () => {
            let payload = null;
            try {
                payload = JSON.parse(xhr.responseText);
            } catch {
                payload = null;
            }

            if (xhr.status >= 200 && xhr.status < 300 && payload) {
                resolve(payload);
                return;
            }

            reject(new Error(payload?.error || `Yukleme basarisiz (${xhr.status})`));
        };

        xhr.onerror = () => reject(new Error('Ag baglantisi kurulamadı.'));
        xhr.send(formData);
    });
}

async function postJson(url, payload) {
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });

    let result = null;
    try {
        result = await response.json();
    } catch {
        result = null;
    }

    if (!response.ok || !result) {
        throw new Error(result?.error || `Istek basarisiz (${response.status})`);
    }

    return result;
}

function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const value = Math.floor(Math.log(bytes) / Math.log(1024));
    const size = bytes / 1024 ** value;
    return `${size.toFixed(size >= 10 || value === 0 ? 0 : 1)} ${units[value]}`;
}

function toast(icon, title) {
    return Swal.fire({
        toast: true,
        position: 'top-end',
        icon,
        title,
        timer: 2200,
        showConfirmButton: false,
        background: 'rgba(30, 41, 59, 0.96)',
        color: '#fff',
    });
}

function formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return new Intl.DateTimeFormat('tr-TR', {
        dateStyle: 'medium',
        timeStyle: 'short',
    }).format(date);
}
