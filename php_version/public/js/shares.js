const state = {
    token: localStorage.getItem('access_token') || '',
};

document.addEventListener('DOMContentLoaded', async () => {
    if (!state.token) {
        logout();
        return;
    }

    await loadShareData();
});

function authHeaders(extra = {}) {
    return {
        Authorization: `Bearer ${state.token}`,
        ...extra,
    };
}

async function fetchJson(url, options = {}) {
    const response = await fetch(url, options);
    const rawText = await response.text();
    let payload = null;

    if (rawText) {
        try {
            payload = JSON.parse(rawText);
        } catch {
            payload = rawText;
        }
    }

    if (!response.ok) {
        throw new Error(payload?.error || payload?.message || `İstek başarısız (${response.status})`);
    }

    return payload;
}

function logout() {
    localStorage.removeItem('access_token');
    window.location.href = '/login';
}

async function copyText(value) {
    try {
        await navigator.clipboard.writeText(value);
        await Swal.fire({
            icon: 'success',
            title: 'Link kopyalandı',
            timer: 1500,
            showConfirmButton: false,
        });
    } catch (error) {
        window.prompt('Linki kopyalayın:', value);
    }
}

async function loadShareData() {
    const singleContainer = document.getElementById('singleShareList');
    const collectionContainer = document.getElementById('collectionShareList');
    singleContainer.innerHTML = emptyMarkup('Tekli paylaşımlar yükleniyor...');
    collectionContainer.innerHTML = emptyMarkup('Koleksiyonlar yükleniyor...');

    try {
        const [singleShares, collections] = await Promise.all([
            fetchJson('/shares/files', { headers: authHeaders() }),
            fetchJson('/shares/collections', { headers: authHeaders() }),
        ]);

        document.getElementById('singleShareCount').textContent = `${singleShares.length} link`;
        document.getElementById('collectionShareCount').textContent = `${collections.length} koleksiyon`;
        renderSingleShares(singleShares);
        renderCollections(collections);
    } catch (error) {
        singleContainer.innerHTML = emptyMarkup(error.message || 'Paylaşımlar alınamadı.');
        collectionContainer.innerHTML = emptyMarkup(error.message || 'Koleksiyonlar alınamadı.');
    }
}

function renderSingleShares(items) {
    const container = document.getElementById('singleShareList');
    if (!items.length) {
        container.innerHTML = emptyMarkup('Henüz tekli paylaşım linki oluşturulmadı.');
        return;
    }

    container.innerHTML = items.map((item) => `
        <article class="share-card">
            <h3>${escapeHtml(item.display_name)}</h3>
            <p class="share-meta">${formatBytes(item.file_size)} • ${escapeHtml(item.mime_type || 'Bilinmeyen tür')}</p>
            <a class="share-link" href="${escapeHtml(item.share_url)}" target="_blank" rel="noopener">${escapeHtml(item.share_url)}</a>
            <div class="share-actions">
                <button class="panel-btn primary" onclick="copyText('${escapeJs(item.share_url)}')">Kopyala</button>
                <button class="panel-btn" onclick="window.open('${escapeJs(item.share_url)}', '_blank', 'noopener')">Aç</button>
            </div>
        </article>
    `).join('');
}

function renderCollections(items) {
    const container = document.getElementById('collectionShareList');
    if (!items.length) {
        container.innerHTML = emptyMarkup('Henüz çoklu paylaşım sayfası oluşturulmadı.');
        return;
    }

    container.innerHTML = items.map((item) => `
        <article class="share-card">
            <h3>${escapeHtml(item.title)}</h3>
            <p class="share-meta">${item.file_count} dosya</p>
            <p class="share-preview">${escapeHtml((item.preview_files || []).join(', ') || 'Önizleme yok')}</p>
            <a class="share-link" href="${escapeHtml(item.share_url)}" target="_blank" rel="noopener">${escapeHtml(item.share_url)}</a>
            <div class="share-actions">
                <button class="panel-btn primary" onclick="copyText('${escapeJs(item.share_url)}')">Kopyala</button>
                <button class="panel-btn" onclick="window.open('${escapeJs(item.share_url)}', '_blank', 'noopener')">Aç</button>
            </div>
        </article>
    `).join('');
}

function emptyMarkup(message) {
    return `<div class="empty-card">${escapeHtml(message)}</div>`;
}

function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const value = Math.floor(Math.log(bytes) / Math.log(1024));
    const size = bytes / 1024 ** value;
    return `${size.toFixed(size >= 10 || value === 0 ? 0 : 1)} ${units[value]}`;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeJs(value) {
    return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
