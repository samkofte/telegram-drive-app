const PREVIEW_SIZE_LIMIT_BYTES = 20 * 1024 * 1024;
const FOLDER_COLOR_OPTIONS = ['#3E577A', '#2563EB', '#7C3AED', '#DB2777', '#EA580C', '#16A34A', '#D97706', '#475569'];
const FOLDER_ICON_OPTIONS = ['folder', 'folder_open', 'workspaces', 'photo_library', 'inventory_2', 'description'];

const state = {
    token: localStorage.getItem('access_token') || '',
    user: null,
    config: null,
    files: [],
    folders: [],
    mode: 'all',
    currentFolderId: null,
    folderHistory: [{ id: null, name: 'Ana Klasör' }],
    selectionMode: false,
    selectedFileIds: new Set(),
    searchQuery: '',
    searchDebounce: null,
    draggedFileId: null,
    activeFolderColor: FOLDER_COLOR_OPTIONS[0],
    activeFolderIcon: FOLDER_ICON_OPTIONS[0],
    previewFile: null,
    trashFiles: [],
    trashFolders: [],
};

let uppy = null;

document.addEventListener('DOMContentLoaded', async () => {
    if (!state.token) {
        logout();
        return;
    }

    bindSearch();
    bindOverlayClose('folderModal', closeCreateFolderModal);
    bindOverlayClose('moveModal', closeMoveModal);
    bindOverlayClose('previewModal', closePreview);
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        closeCreateFolderModal();
        closeMoveModal();
        closePreview();
    });

    renderFolderOptionPickers();
    await bootstrap();
});

async function bootstrap() {
    try {
        const [config, user] = await Promise.all([
            fetchJson('/config'),
            fetchJson('/auth/me', { headers: authHeaders() }),
        ]);
        state.config = config;
        state.user = user;
        renderUserSummary();
        initUppy();
        await loadContent();
    } catch (error) {
        console.error('bootstrap error', error);
        toast('error', 'Oturum doğrulanamadı', error.message || 'Tekrar giriş yapman gerekiyor.');
        setTimeout(logout, 800);
    }
}

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

function toast(icon, title, text) {
    return Swal.fire({
        toast: true,
        position: 'top-end',
        icon,
        title,
        text,
        timer: 2400,
        showConfirmButton: false,
        background: 'rgba(30, 41, 59, 0.96)',
        color: '#fff',
    });
}

function logout() {
    localStorage.removeItem('access_token');
    window.location.href = '/login';
}

function bindSearch() {
    document.getElementById('searchInput').addEventListener('input', (event) => {
        state.searchQuery = event.target.value.trim();
        if (state.searchDebounce) {
            clearTimeout(state.searchDebounce);
        }
        state.searchDebounce = setTimeout(() => {
            loadContent();
        }, 220);
    });
}

function bindOverlayClose(id, callback) {
    const node = document.getElementById(id);
    node.addEventListener('click', (event) => {
        if (event.target === node) {
            callback();
        }
    });
}

function renderUserSummary() {
    const user = state.user || {};
    const stats = user.stats || {};
    const plan = user.plan || {};
    const used = Number(stats.storage_used || 0);
    const limit = Number(stats.storage_limit || plan.storage_limit || 0);
    const percent = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
    const displayName = user.username || [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email || 'Kullanıcı';

    document.getElementById('userEmail').textContent = displayName;
    document.getElementById('userSubtext').textContent = user.role === 'admin' ? 'Yönetici' : 'Sistem Üyesi';
    document.getElementById('statFileCount').textContent = String(stats.file_count || 0);
    document.getElementById('statSharedCount').textContent = String(stats.shared_count || 0);
    document.getElementById('statStorage').textContent = `${formatBytes(used)} / ${formatBytes(limit)}`;
    document.getElementById('storageFill').style.width = `${percent}%`;
}

function syncUploadTargetLabel() {
    const label = state.currentFolderId
        ? `Yükleme hedefi: ${state.folderHistory[state.folderHistory.length - 1]?.name || 'Seçili klasör'}`
        : 'Yükleme hedefi: Ana Klasör';
    document.getElementById('uploadTargetLabel').textContent = label;
}

function initUppy() {
    if (typeof Uppy === 'undefined') return;

    uppy = new Uppy.Uppy({
        autoProceed: false,
        restrictions: {
            maxFileSize: 2 * 1024 * 1024 * 1024,
        },
        locale: Uppy.locales.tr_TR,
    })
        .use(Uppy.Dashboard, {
            target: '#uppy-dashboard',
            inline: true,
            height: 430,
            width: '100%',
            showProgressDetails: true,
            note: 'Aynı anda birden fazla dosya yükleyebilir, mevcut klasörü hedefleyebilirsin.',
            proudlyDisplayPoweredByUppy: false,
            theme: 'dark',
            browserBackButtonClose: true,
        })
        .use(Uppy.ImageEditor, { target: Uppy.Dashboard })
        .use(Uppy.XHRUpload, {
            endpoint: '/upload',
            formData: true,
            fieldName: 'file',
            limit: 5,
            allowedMetaFields: ['folder_id'],
            headers: () => authHeaders(),
        });

    const syncMeta = () => {
        if (!uppy) return;
        uppy.getFiles().forEach((file) => {
            uppy.setFileMeta(file.id, { folder_id: state.currentFolderId || '' });
        });
    };

    uppy.on('file-added', syncMeta);
    uppy.on('upload', syncMeta);
    uppy.on('complete', async (result) => {
        if (result.successful.length > 0) {
            await refreshUser();
            await loadContent();
            toast('success', 'Yükleme tamamlandı', `${result.successful.length} dosya başarıyla yüklendi.`);
        }
        if (result.failed.length > 0) {
            const message = result.failed[0]?.error?.message || result.failed[0]?.error || 'Yükleme sırasında hata oluştu.';
            toast('error', 'Yükleme hatası', String(message));
        }
    });

    syncUploadTargetLabel();
}

async function refreshUser() {
    state.user = await fetchJson('/auth/me', { headers: authHeaders() });
    renderUserSummary();
}

async function loadContent() {
    syncUploadTargetLabel();
    updateModeButtons();
    updateFolderSectionState();
    renderBreadcrumbs();
    renderFolders([], true);
    renderFiles([], true);
    updateSelectionBar();
    updateDownloadHub();

    try {
        const fileQuery = new URLSearchParams();
        if (state.currentFolderId) fileQuery.set('folder_id', state.currentFolderId);
        if (state.mode === 'favorites') fileQuery.set('favorites', 'true');
        if (state.mode === 'trash') fileQuery.set('trash', 'true');
        if (state.searchQuery) fileQuery.set('search', state.searchQuery);

        const folderQuery = new URLSearchParams();
        folderQuery.set('parent_id', state.currentFolderId || 'root');
        if (state.mode === 'trash') folderQuery.set('trash', 'true');

        const trashFileQuery = new URLSearchParams();
        trashFileQuery.set('trash', 'true');
        const trashFolderQuery = new URLSearchParams();
        trashFolderQuery.set('trash', 'true');

        const [files, folders, trashFiles, trashFolders] = await Promise.all([
            fetchJson(`/files?${fileQuery.toString()}`, { headers: authHeaders() }),
            state.mode === 'favorites'
                ? Promise.resolve([])
                : fetchJson(`/folders?${folderQuery.toString()}`, { headers: authHeaders() }),
            fetchJson(`/files?${trashFileQuery.toString()}`, { headers: authHeaders() }),
            fetchJson(`/folders?${trashFolderQuery.toString()}`, { headers: authHeaders() }),
        ]);

        state.files = Array.isArray(files) ? files : [];
        const nextFolders = Array.isArray(folders) ? folders : [];
        state.trashFiles = Array.isArray(trashFiles) ? trashFiles : [];
        state.trashFolders = Array.isArray(trashFolders) ? trashFolders : [];
        state.folders = state.searchQuery
            ? nextFolders.filter((folder) => folder.name?.toLowerCase().includes(state.searchQuery.toLowerCase()))
            : nextFolders;

        pruneSelection();
        renderBreadcrumbs();
        renderFolders(state.folders);
        renderFiles(state.files);
        updateSelectionBar();
        updateFolderSectionState();
        updateDownloadHub();
        updateTrashOverview();
    } catch (error) {
        console.error('load content error', error);
        renderFolders([]);
        renderFiles([]);
        updateDownloadHub();
        toast('error', 'İçerik yüklenemedi', error.message || 'Dosyalar alınamadı.');
    }
}

function updateModeButtons() {
    document.querySelectorAll('.mode-btn').forEach((button) => {
        button.classList.toggle('active', button.dataset.mode === state.mode);
    });
    document.getElementById('createFolderBtn').classList.toggle('disabled', state.mode !== 'all');
}

function updateFolderSectionState() {
    const section = document.getElementById('foldersSection');
    const title = document.getElementById('folderSectionTitle');
    const subtitle = document.getElementById('folderSectionSubtitle');

    if (state.mode === 'favorites') {
        section.classList.add('hidden');
        return;
    }

    section.classList.remove('hidden');
    title.textContent = state.mode === 'trash' ? 'Çöp Kutusundaki Klasörler' : 'Klasörler';
    subtitle.textContent = state.mode === 'trash'
        ? 'Geri yükle veya kalıcı olarak temizle'
        : 'Klasörleri aç, sürükle bırak ile dosya taşı veya yeni klasör oluştur';
}

function pruneSelection() {
    const validIds = new Set(state.files.map((file) => String(file.id)));
    [...state.selectedFileIds].forEach((id) => {
        if (!validIds.has(String(id))) {
            state.selectedFileIds.delete(String(id));
        }
    });
}

function renderBreadcrumbs() {
    const container = document.getElementById('breadcrumbs');
    if (state.mode !== 'all') {
        container.classList.add('hidden');
        container.innerHTML = '';
        return;
    }
    container.classList.remove('hidden');
    container.innerHTML = state.folderHistory.map((item, index) => {
        const active = index === state.folderHistory.length - 1;
        return `<button class="crumb-btn ${active ? 'active' : ''}" onclick="goToBreadcrumb(${index})">${escapeHtml(item.name)}</button>`;
    }).join('');
}

function renderFolders(folders, loading = false) {
    const container = document.getElementById('foldersContainer');
    const visibleCount = state.mode === 'all' ? folders.length + 1 : folders.length;
    document.getElementById('folderCountLabel').textContent = `${visibleCount} kart`;

    if (loading) {
        container.innerHTML = emptyMarkup('sync', 'Klasörler yükleniyor...');
        return;
    }

    if (!folders.length) {
        if (state.mode === 'all') {
            container.innerHTML = createFolderCardMarkup();
            return;
        }
        container.innerHTML = emptyMarkup('folder_open', state.mode === 'trash' ? 'Çöp kutusunda klasör yok.' : 'Bu görünümde klasör yok.');
        return;
    }

    const folderCards = folders.map((folder) => folderCardMarkup(folder)).join('');
    container.innerHTML = state.mode === 'all' ? createFolderCardMarkup() + folderCards : folderCards;
}

function createFolderCardMarkup() {
    return `
        <div class="item-card folder-card folder-create-card" onclick="openCreateFolderModal()">
            <div class="item-top">
                <div class="folder-swatch create-folder-swatch">
                    <span class="material-symbols-outlined">create_new_folder</span>
                </div>
                <div class="item-main">
                    <p class="item-name">Yeni Klasör Oluştur</p>
                    <div class="item-subtitle">Renk ve ikon seçerek bu klasörün içine yeni bir alan ekle.</div>
                </div>
            </div>
            <div class="folder-accent" style="--folder-color:#2563eb;"></div>
            <div class="tag-row">
                <span class="tag-chip primary">Hızlı Ekle</span>
                <span class="tag-chip">Renk + ikon</span>
            </div>
            <div class="action-row">
                <div class="action-cluster">
                    <button class="icon-btn success" onclick="event.stopPropagation(); openCreateFolderModal()">
                        <span class="material-symbols-outlined">add</span>
                    </button>
                </div>
            </div>
        </div>
    `;
}

function folderCardMarkup(folder) {
    const folderColor = folder.color || '#3E577A';
    const folderIcon = folder.icon || 'folder';
    const styleBg = hexToRgba(folderColor, 0.16);
    const styleBorder = hexToRgba(folderColor, 0.28);
    const actionButtons = state.mode === 'trash'
        ? `
            <button class="icon-btn success" onclick="event.stopPropagation(); restoreFolder('${folder.id}')">
                <span class="material-symbols-outlined">restore_from_trash</span>
            </button>
            <button class="icon-btn danger" onclick="event.stopPropagation(); permanentlyDeleteFolder('${folder.id}', '${escapeJs(folder.name)}')">
                <span class="material-symbols-outlined">delete_forever</span>
            </button>
        `
        : `
            <button class="icon-btn" onclick="event.stopPropagation(); openFolder('${folder.id}', '${escapeJs(folder.name)}')">
                <span class="material-symbols-outlined">folder_open</span>
            </button>
            <button class="icon-btn danger" onclick="event.stopPropagation(); trashFolder('${folder.id}', '${escapeJs(folder.name)}')">
                <span class="material-symbols-outlined">delete</span>
            </button>
        `;

    return `
        <div class="item-card folder-card" id="folder-card-${folder.id}" onclick="handleFolderCardClick('${folder.id}', '${escapeJs(folder.name)}')"
            ${state.mode !== 'trash' ? `ondragover="handleFolderDragOver(event, '${folder.id}')" ondragleave="handleFolderDragLeave(event, '${folder.id}')" ondrop="handleFolderDrop(event, '${folder.id}')"` : ''}>
            <div class="item-top">
                <div class="folder-swatch" style="background:${styleBg}; color:${folderColor}; border:1px solid ${styleBorder};">
                    <span class="material-symbols-outlined">${folderIcon}</span>
                </div>
                <div class="item-main">
                    <p class="item-name">${escapeHtml(folder.name)}</p>
                    <div class="item-subtitle">${state.mode === 'trash' ? 'Çöp kutusunda. Geri yükleyebilir veya kalıcı temizleyebilirsin.' : 'Klasörü aç veya dosyayı bu karta sürükleyip bırak.'}</div>
                </div>
            </div>
            <div class="folder-accent" style="--folder-color:${folderColor};"></div>
            <div class="tag-row">
                <span class="tag-chip primary">${state.mode === 'trash' ? 'Çöpte' : 'Hazır'}</span>
                <span class="tag-chip">${escapeHtml(folderIcon)}</span>
            </div>
            <div class="action-row">
                <div class="action-cluster">${actionButtons}</div>
            </div>
        </div>
    `;
}

function renderFiles(files, loading = false) {
    const container = document.getElementById('filesContainer');
    document.getElementById('fileCountLabel').textContent = `${files.length} dosya`;

    if (loading) {
        container.innerHTML = emptyMarkup('sync', 'Dosyalar yükleniyor...');
        return;
    }

    if (!files.length) {
        container.innerHTML = emptyMarkup('inventory_2', state.mode === 'trash' ? 'Çöp kutusunda dosya yok.' : 'Henüz dosya yok.');
        return;
    }

    container.innerHTML = files.map((file) => fileCardMarkup(file)).join('');
}

function fileCardMarkup(file) {
    const previewableImage = isImageFile(file) && !isPreviewBlocked(file);
    const fileIcon = getFileIconMeta(file);
    const selected = state.selectedFileIds.has(String(file.id));
    const mediaLeading = previewableImage
        ? `<div class="leading-icon"><img src="/preview/${encodeURIComponent(file.file_id)}?token=${encodeURIComponent(state.token)}" alt="${escapeHtml(getDisplayName(file))}"></div>`
        : `<div class="leading-icon" style="background:${fileIcon.bg}; color:${fileIcon.color};"><span class="material-symbols-outlined">${fileIcon.name}</span></div>`;
    const regularActions = `
        <button class="icon-btn" onclick="event.stopPropagation(); openPreviewById('${file.id}')"><span class="material-symbols-outlined">preview</span></button>
        <button class="icon-btn success" onclick="event.stopPropagation(); downloadFileById('${file.id}')"><span class="material-symbols-outlined">download</span></button>
        <button class="icon-btn warning" onclick="event.stopPropagation(); toggleFavorite('${file.id}')"><span class="material-symbols-outlined">${file.is_favorite ? 'star' : 'star_outline'}</span></button>
        <button class="icon-btn" onclick="event.stopPropagation(); shareFileLink('${file.id}')"><span class="material-symbols-outlined">share</span></button>
        <button class="icon-btn" onclick="event.stopPropagation(); renameFile('${file.id}')"><span class="material-symbols-outlined">edit</span></button>
        <button class="icon-btn danger" onclick="event.stopPropagation(); trashFile('${file.id}', '${escapeJs(getDisplayName(file))}')"><span class="material-symbols-outlined">delete</span></button>
    `;
    const trashActions = `
        <button class="icon-btn success" onclick="event.stopPropagation(); restoreFile('${file.id}')"><span class="material-symbols-outlined">restore_from_trash</span></button>
        <button class="icon-btn danger" onclick="event.stopPropagation(); permanentlyDeleteFile('${file.id}', '${escapeJs(getDisplayName(file))}')"><span class="material-symbols-outlined">delete_forever</span></button>
    `;

    return `
        <div class="item-card ${selected ? 'selected' : ''}" id="file-card-${file.id}" onclick="handleFileCardClick('${file.id}')"
            ${!state.selectionMode && state.mode !== 'trash' ? `draggable="true" ondragstart="startFileDrag(event, '${file.id}')" ondragend="endFileDrag()"` : ''}>
            <div class="item-top">
                <button class="quick-select-btn ${selected ? 'active' : ''}" onclick="event.stopPropagation(); toggleFileSelection('${file.id}')">
                    <span class="material-symbols-outlined">${selected ? 'check_circle' : 'radio_button_unchecked'}</span>
                </button>
                ${state.selectionMode ? `<div class="selection-check ${selected ? 'active' : ''}"><span class="material-symbols-outlined">check</span></div>` : mediaLeading}
                <div class="item-main">
                    <p class="item-name">${escapeHtml(getDisplayName(file))}</p>
                    <div class="item-subtitle">${escapeHtml(file.filename || '')}</div>
                    <div class="meta-row">
                        <span class="meta-chip">${formatBytes(file.file_size)}</span>
                        <span class="meta-chip">${Number(file.download_count || 0)} indirme</span>
                    </div>
                </div>
                ${!state.selectionMode && state.mode !== 'trash' ? '<div class="drag-handle"><span class="material-symbols-outlined">drag_indicator</span></div>' : ''}
            </div>
            <div class="tag-row">
                ${file.is_favorite ? '<span class="tag-chip primary">Favori</span>' : ''}
                ${file.is_chunked ? '<span class="tag-chip warning">Parçalı</span>' : ''}
                ${isPreviewBlocked(file) ? '<span class="tag-chip warning">Önizleme kapalı</span>' : '<span class="tag-chip primary">Önizleme hazır</span>'}
            </div>
            <div class="action-row">
                <div class="action-cluster">${state.mode === 'trash' ? trashActions : regularActions}</div>
            </div>
        </div>
    `;
}

function updateSelectionBar() {
    const selectionBar = document.getElementById('selectionBar');
    selectionBar.classList.toggle('hidden', !state.selectionMode);
    document.getElementById('selectionCountText').textContent = `${state.selectedFileIds.size} dosya seçildi`;
    ['bulkDownloadBtn', 'bulkMoveBtn', 'bulkDeleteBtn', 'bulkShareBtn', 'bulkZipBtn', 'bulkRestoreBtn'].forEach((id) => {
        document.getElementById(id).classList.toggle('disabled', state.selectedFileIds.size === 0);
    });
    document.getElementById('bulkMoveBtn').classList.toggle('hidden', state.mode === 'trash');
    document.getElementById('bulkShareBtn').classList.toggle('hidden', state.mode === 'trash');
    document.getElementById('bulkZipBtn').classList.toggle('hidden', state.mode === 'trash');
    document.getElementById('bulkDownloadBtn').classList.toggle('hidden', state.mode === 'trash');
    document.getElementById('bulkRestoreBtn').classList.toggle('hidden', state.mode !== 'trash');
    document.getElementById('selectionToggleLabel').textContent = state.selectionMode ? 'Seçimi Bitir' : 'Toplu Seç';
    document.getElementById('bulkDeleteBtn').lastElementChild.textContent = state.mode === 'trash' ? 'Kalıcı Sil' : 'Sil';
}

function toggleSelectionMode(nextState) {
    state.selectionMode = typeof nextState === 'boolean' ? nextState : !state.selectionMode;
    if (!state.selectionMode) {
        state.selectedFileIds.clear();
    }
    updateSelectionBar();
    updateDownloadHub();
    renderFiles(state.files);
}

function handleFileCardClick(fileId) {
    if (!state.selectionMode) {
        openPreviewById(fileId);
        return;
    }
    toggleFileSelection(fileId);
}

function toggleFileSelection(fileId) {
    const key = String(fileId);
    if (!state.selectionMode) {
        state.selectionMode = true;
    }
    if (state.selectedFileIds.has(key)) {
        state.selectedFileIds.delete(key);
    } else {
        state.selectedFileIds.add(key);
    }
    if (state.selectedFileIds.size === 0) {
        state.selectionMode = false;
    }
    updateSelectionBar();
    updateDownloadHub();
    renderFiles(state.files);
}

function handleFolderCardClick(folderId, folderName) {
    if (state.selectionMode && state.selectedFileIds.size > 0 && state.mode !== 'trash') {
        moveSelectedFiles(folderId, folderName);
        return;
    }
    openFolder(folderId, folderName);
}

function setMode(mode) {
    if (!['all', 'favorites', 'trash'].includes(mode)) return;
    state.mode = mode;
    state.currentFolderId = null;
    state.folderHistory = [{ id: null, name: 'Ana Klasör' }];
    toggleSelectionMode(false);
    loadContent();
}

function openFolder(folderId, folderName) {
    if (state.mode !== 'all') return;
    state.currentFolderId = folderId;
    state.folderHistory.push({ id: folderId, name: folderName });
    loadContent();
}

function goToBreadcrumb(index) {
    state.folderHistory = state.folderHistory.slice(0, index + 1);
    state.currentFolderId = state.folderHistory[state.folderHistory.length - 1]?.id || null;
    loadContent();
}

function selectAllVisibleFiles() {
    if (!state.selectionMode) return;
    if (state.selectedFileIds.size === state.files.length) {
        state.selectedFileIds.clear();
    } else {
        state.files.forEach((file) => state.selectedFileIds.add(String(file.id)));
    }
    updateSelectionBar();
    updateDownloadHub();
    renderFiles(state.files);
}

function updateDownloadHub() {
    const selectedCount = state.selectedFileIds.size;
    const zipButton = document.getElementById('downloadHubZipBtn');
    const bulkButton = document.getElementById('downloadHubBulkBtn');
    const shareButton = document.getElementById('downloadHubShareBtn');
    const note = document.getElementById('downloadHubNote');
    const inTrashMode = state.mode === 'trash';

    [zipButton, bulkButton, shareButton].forEach((button) => {
        button.classList.toggle('disabled', selectedCount === 0);
    });

    zipButton.classList.toggle('hidden', inTrashMode);
    bulkButton.classList.toggle('hidden', inTrashMode);
    shareButton.classList.toggle('hidden', inTrashMode);

    if (inTrashMode) {
        note.textContent = selectedCount > 0
            ? 'Çöp görünümünde seçilen dosyaları geri yükleyebilir veya kalıcı silebilirsin.'
            : 'Çöp kutusunda toplu geri yükleme ve kalıcı silme için dosya seç.';
        return;
    }

    note.textContent = selectedCount > 0
        ? `${selectedCount} dosya seçili. Tek tek indir, ZIP yap veya çoklu paylaşım sayfası oluştur.`
        : 'ZIP ve çoklu paylaşım için önce dosya seç.';
}

function updateTrashOverview() {
    document.getElementById('trashFileCount').textContent = `${state.trashFiles.length} dosya`;
    document.getElementById('trashFolderCount').textContent = `${state.trashFolders.length} klasör`;
}

function renderFolderOptionPickers() {
    document.getElementById('folderColorOptions').innerHTML = FOLDER_COLOR_OPTIONS.map((color) => `
        <button class="option-btn ${state.activeFolderColor === color ? 'active' : ''}" onclick="selectFolderColor('${color}')">
            <span class="color-dot" style="background:${color};"></span>
        </button>
    `).join('');

    document.getElementById('folderIconOptions').innerHTML = FOLDER_ICON_OPTIONS.map((icon) => `
        <button class="option-btn ${state.activeFolderIcon === icon ? 'active' : ''}" onclick="selectFolderIcon('${icon}')">
            <span class="material-symbols-outlined">${icon}</span>
        </button>
    `).join('');
}

function selectFolderColor(color) {
    state.activeFolderColor = color;
    renderFolderOptionPickers();
}

function selectFolderIcon(icon) {
    state.activeFolderIcon = icon;
    renderFolderOptionPickers();
}

function openCreateFolderModal() {
    if (state.mode !== 'all') return;
    document.getElementById('folderNameInput').value = '';
    state.activeFolderColor = FOLDER_COLOR_OPTIONS[0];
    state.activeFolderIcon = FOLDER_ICON_OPTIONS[0];
    renderFolderOptionPickers();
    document.getElementById('folderModal').classList.remove('hidden');
    document.getElementById('folderModal').classList.add('open');
}

function closeCreateFolderModal() {
    document.getElementById('folderModal').classList.remove('open');
    document.getElementById('folderModal').classList.add('hidden');
}

async function createFolder() {
    const name = document.getElementById('folderNameInput').value.trim();
    if (!name) {
        toast('info', 'Klasör adı gerekli', 'Lütfen klasör için bir ad gir.');
        return;
    }
    try {
        await fetchJson('/folders', {
            method: 'POST',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({
                name,
                color: state.activeFolderColor,
                icon: state.activeFolderIcon,
                parent_id: state.currentFolderId,
            }),
        });
        closeCreateFolderModal();
        toast('success', 'Klasör oluşturuldu', 'Yeni klasör hazır.');
        await loadContent();
    } catch (error) {
        toast('error', 'Klasör oluşturulamadı', error.message || 'İşlem başarısız.');
    }
}

async function buildMoveOptions() {
    const collected = [{ id: null, name: 'Ana Klasör', depth: 0 }];
    async function walk(parentId, depth) {
        const folders = await fetchJson(`/folders?parent_id=${parentId || 'root'}`, { headers: authHeaders() });
        for (const folder of folders) {
            collected.push({ id: String(folder.id), name: folder.name, depth });
            await walk(String(folder.id), depth + 1);
        }
    }
    await walk(null, 1);
    return collected;
}

async function openMoveModal() {
    if (state.selectedFileIds.size === 0 || state.mode === 'trash') return;
    const modal = document.getElementById('moveModal');
    const container = document.getElementById('moveOptionsContainer');
    modal.classList.remove('hidden');
    modal.classList.add('open');
    container.innerHTML = emptyMarkup('sync', 'Klasörler hazırlanıyor...');
    try {
        const options = await buildMoveOptions();
        container.innerHTML = options.map((option) => `
            <button class="move-option" onclick="moveSelectedFiles('${option.id ?? ''}', '${escapeJs(option.name)}')">
                <span class="material-symbols-outlined">${option.id ? 'folder' : 'home'}</span>
                <span>${escapeHtml(option.name)}</span>
            </button>
        `).join('');
    } catch (error) {
        container.innerHTML = emptyMarkup('error', error.message || 'Hedef klasörler alınamadı.');
    }
}

function closeMoveModal() {
    document.getElementById('moveModal').classList.remove('open');
    document.getElementById('moveModal').classList.add('hidden');
}

async function moveSelectedFiles(folderId, folderName) {
    if (state.selectedFileIds.size === 0) return;
    const targetId = folderId || null;
    const selectedCount = state.selectedFileIds.size;
    try {
        await Promise.all([...state.selectedFileIds].map((fileId) => fetchJson(`/files/${fileId}/move`, {
            method: 'POST',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ folder_id: targetId }),
        })));
        closeMoveModal();
        toggleSelectionMode(false);
        toast('success', 'Dosyalar taşındı', `${selectedCount} dosya ${folderName || 'Ana Klasör'} hedefine taşındı.`);
        await loadContent();
    } catch (error) {
        toast('error', 'Taşıma başarısız', error.message || 'Dosyalar taşınamadı.');
    }
}

async function confirmBulkDelete() {
    if (state.selectedFileIds.size === 0) return;
    const permanent = state.mode === 'trash';
    const confirm = await Swal.fire({
        icon: 'warning',
        title: permanent ? 'Kalıcı silme' : 'Toplu silme',
        text: permanent
            ? `${state.selectedFileIds.size} dosya Telegram dahil kalıcı olarak silinecek.`
            : `${state.selectedFileIds.size} dosya çöp kutusuna taşınacak.`,
        showCancelButton: true,
        confirmButtonText: permanent ? 'Kalıcı sil' : 'Çöpe taşı',
        cancelButtonText: 'Vazgeç',
        confirmButtonColor: permanent ? '#ef4444' : '#2563eb',
    });
    if (!confirm.isConfirmed) return;

    try {
        if (permanent) {
            await Promise.all([...state.selectedFileIds].map((fileId) => fetchJson(`/files/${fileId}/trash`, { method: 'DELETE', headers: authHeaders() })));
        } else {
            await Promise.all([...state.selectedFileIds].map((fileId) => fetchJson(`/files/${fileId}/trash`, {
                method: 'POST',
                headers: authHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ restore: false }),
            })));
        }
        const count = state.selectedFileIds.size;
        toggleSelectionMode(false);
        await refreshUser();
        await loadContent();
        toast('success', 'Toplu işlem tamamlandı', `${count} dosya işlendi.`);
    } catch (error) {
        toast('error', 'Toplu işlem başarısız', error.message || 'Seçili dosyalar işlenemedi.');
    }
}

async function bulkRestoreSelected() {
    if (state.selectedFileIds.size === 0 || state.mode !== 'trash') return;

    try {
        await Promise.all([...state.selectedFileIds].map((fileId) => fetchJson(`/files/${fileId}/trash`, {
            method: 'POST',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ restore: true }),
        })));
        const count = state.selectedFileIds.size;
        toggleSelectionMode(false);
        await refreshUser();
        await loadContent();
        toast('success', 'Dosyalar geri yüklendi', `${count} dosya aktif listeye alındı.`);
    } catch (error) {
        toast('error', 'Toplu geri yükleme başarısız', error.message || 'Seçili dosyalar geri getirilemedi.');
    }
}

function getFileById(fileId) {
    return state.files.find((file) => String(file.id) === String(fileId));
}

async function toggleFavorite(fileId) {
    try {
        await fetchJson(`/files/${fileId}/favorite`, { method: 'POST', headers: authHeaders() });
        const file = getFileById(fileId);
        if (file) {
            file.is_favorite = !file.is_favorite;
        }
        renderFiles(state.files);
        refreshUser();
    } catch (error) {
        toast('error', 'Favori güncellenemedi', error.message || 'İşlem başarısız.');
    }
}

async function shareFileLink(fileId) {
    const file = getFileById(fileId);
    if (!file) return;

    try {
        const result = await fetchJson(`/files/${fileId}/share-link`, { method: 'POST', headers: authHeaders() });
        const shareUrl = result?.share_url;
        if (!shareUrl) {
            throw new Error('Paylaşım bağlantısı üretilemedi.');
        }

        if (navigator.share) {
            try {
                await navigator.share({
                    title: getDisplayName(file),
                    text: `Bu dosyayı indir:\n${getDisplayName(file)}\n${shareUrl}`,
                    url: shareUrl,
                });
                return;
            } catch {
            }
        }

        await Swal.fire({
            title: 'Paylaşım bağlantısı hazır',
            html: `<input class="swal2-input" style="width:100%;margin:0;" value="${escapeHtml(shareUrl)}" readonly>`,
            showCancelButton: true,
            confirmButtonText: 'Kopyala',
            cancelButtonText: 'Kapat',
            preConfirm: async () => {
                await navigator.clipboard.writeText(shareUrl);
            },
        });
        refreshUser();
    } catch (error) {
        toast('error', 'Paylaşım başarısız', error.message || 'Bağlantı üretilemedi.');
    }
}

async function renameFile(fileId) {
    const file = getFileById(fileId);
    if (!file) return;

    const result = await Swal.fire({
        title: 'Yeniden adlandır',
        input: 'text',
        inputValue: getDisplayName(file),
        inputPlaceholder: 'Yeni görünür ad',
        showCancelButton: true,
        confirmButtonText: 'Kaydet',
        cancelButtonText: 'Vazgeç',
        inputValidator: (value) => {
            if (!value || !value.trim()) {
                return 'Görünür ad boş olamaz';
            }
            return undefined;
        },
    });

    if (!result.isConfirmed) return;

    try {
        await fetchJson(`/files/${fileId}/rename`, {
            method: 'POST',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ display_name: result.value.trim() }),
        });
        file.display_name = result.value.trim();
        renderFiles(state.files);
        if (state.previewFile && String(state.previewFile.id) === String(fileId)) {
            state.previewFile.display_name = result.value.trim();
            renderPreview();
        }
        toast('success', 'Dosya güncellendi', 'Yeni görünür ad kaydedildi.');
    } catch (error) {
        toast('error', 'Yeniden adlandırılamadı', error.message || 'İşlem başarısız.');
    }
}

async function trashFile(fileId, fileName) {
    const confirm = await Swal.fire({
        icon: 'warning',
        title: 'Dosya çöp kutusuna taşınsın mı?',
        text: `"${fileName}" dosyası çöp kutusuna alınacak.`,
        showCancelButton: true,
        confirmButtonText: 'Evet',
        cancelButtonText: 'Vazgeç',
    });
    if (!confirm.isConfirmed) return;

    try {
        await fetchJson(`/files/${fileId}/trash`, {
            method: 'POST',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ restore: false }),
        });
        await refreshUser();
        await loadContent();
        toast('success', 'Dosya taşındı', 'Dosya çöp kutusuna gönderildi.');
    } catch (error) {
        toast('error', 'İşlem başarısız', error.message || 'Dosya taşınamadı.');
    }
}

async function restoreFile(fileId) {
    try {
        await fetchJson(`/files/${fileId}/trash`, {
            method: 'POST',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ restore: true }),
        });
        await refreshUser();
        await loadContent();
        toast('success', 'Dosya geri yüklendi', 'Dosya tekrar aktif listeye alındı.');
    } catch (error) {
        toast('error', 'Geri yükleme başarısız', error.message || 'Dosya geri getirilemedi.');
    }
}

async function permanentlyDeleteFile(fileId, fileName) {
    const confirm = await Swal.fire({
        icon: 'warning',
        title: 'Kalıcı silme',
        text: `"${fileName}" Telegram dahil kalıcı olarak silinecek.`,
        showCancelButton: true,
        confirmButtonText: 'Kalıcı sil',
        cancelButtonText: 'Vazgeç',
        confirmButtonColor: '#ef4444',
    });
    if (!confirm.isConfirmed) return;

    try {
        await fetchJson(`/files/${fileId}/trash`, { method: 'DELETE', headers: authHeaders() });
        await refreshUser();
        await loadContent();
        toast('success', 'Dosya silindi', 'Dosya Telegram tarafından da temizlendi.');
    } catch (error) {
        toast('error', 'Silme başarısız', error.message || 'Dosya silinemedi.');
    }
}

async function trashFolder(folderId, folderName) {
    const confirm = await Swal.fire({
        icon: 'warning',
        title: 'Klasör çöp kutusuna taşınsın mı?',
        text: `"${folderName}" klasörü çöp kutusuna alınacak.`,
        showCancelButton: true,
        confirmButtonText: 'Evet',
        cancelButtonText: 'Vazgeç',
    });
    if (!confirm.isConfirmed) return;

    try {
        await fetchJson(`/folders/${folderId}/trash`, {
            method: 'POST',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ restore: false }),
        });
        await loadContent();
        toast('success', 'Klasör taşındı', 'Klasör çöp kutusuna gönderildi.');
    } catch (error) {
        toast('error', 'Klasör taşınamadı', error.message || 'İşlem başarısız.');
    }
}

async function restoreFolder(folderId) {
    try {
        await fetchJson(`/folders/${folderId}/trash`, {
            method: 'POST',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ restore: true }),
        });
        await loadContent();
        toast('success', 'Klasör geri yüklendi', 'Klasör tekrar aktif listeye alındı.');
    } catch (error) {
        toast('error', 'Geri yükleme başarısız', error.message || 'Klasör geri getirilemedi.');
    }
}

async function permanentlyDeleteFolder(folderId, folderName) {
    const confirm = await Swal.fire({
        icon: 'warning',
        title: 'Kalıcı klasör silme',
        text: `"${folderName}" ve içindeki dosyalar Telegram dahil kalıcı olarak silinecek.`,
        showCancelButton: true,
        confirmButtonText: 'Kalıcı sil',
        cancelButtonText: 'Vazgeç',
        confirmButtonColor: '#ef4444',
    });
    if (!confirm.isConfirmed) return;

    try {
        const result = await fetchJson(`/folders/${folderId}/trash`, { method: 'DELETE', headers: authHeaders() });
        await loadContent();
        toast('success', 'Klasör silindi', `${result.deleted_file_count || 0} dosya ve ${result.deleted_folder_count || 0} klasör temizlendi.`);
    } catch (error) {
        toast('error', 'Silme başarısız', error.message || 'Klasör silinemedi.');
    }
}

async function downloadFile(file, options = {}) {
    const showToastMessage = options.showToast !== false;
    const downloadUrl = `/download/${encodeURIComponent(file.file_id)}?token=${encodeURIComponent(state.token)}`;

    try {
        const frame = document.createElement('iframe');
        frame.style.display = 'none';
        frame.src = downloadUrl;
        document.body.appendChild(frame);
        setTimeout(() => frame.remove(), 12000);
        await new Promise((resolve) => setTimeout(resolve, 650));
        if (showToastMessage) {
            toast('success', 'İndirme hazır', `${getDisplayName(file)} indirildi.`);
        }
    } catch (error) {
        if (showToastMessage) {
            toast('error', 'İndirme başarısız', error.message || 'Dosya indirilemedi.');
        }
        throw error;
    }
}

async function downloadBlobFromEndpoint(url, options = {}, fallbackName = 'download.bin') {
    const response = await fetch(url, options);
    if (!response.ok) {
        const raw = await response.text();
        let payload = null;
        try {
            payload = JSON.parse(raw);
        } catch {
            payload = raw;
        }
        throw new Error(payload?.error || payload?.message || `İstek başarısız (${response.status})`);
    }

    const blob = await response.blob();
    const contentDisposition = response.headers.get('Content-Disposition') || '';
    const fileNameMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
    const downloadName = fileNameMatch?.[1] || fallbackName;
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = downloadName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
}

async function downloadFileById(fileId) {
    const file = getFileById(fileId);
    if (file) {
        await downloadFile(file);
    }
}

async function bulkDownloadSelected() {
    if (state.selectedFileIds.size === 0) return;
    const files = state.files.filter((file) => state.selectedFileIds.has(String(file.id)));
    try {
        for (let index = 0; index < files.length; index += 1) {
            await downloadFile(files[index], { showToast: false });
        }
        toast('success', 'Toplu indirme tamamlandı', `${files.length} dosya indirildi.`);
    } catch (error) {
        toast('error', 'Toplu indirme başarısız', error.message || 'Bazı dosyalar indirilemedi.');
    }
}

async function bulkZipDownloadSelected() {
    if (state.selectedFileIds.size === 0 || state.mode === 'trash') return;

    try {
        await downloadBlobFromEndpoint('/download/bundle', {
            method: 'POST',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ file_ids: [...state.selectedFileIds] }),
        }, 'telegram-drive-bundle.zip');
        toast('success', 'ZIP hazırlanıyor', `${state.selectedFileIds.size} dosya tek arşiv halinde indirildi.`);
    } catch (error) {
        toast('error', 'ZIP indirilemedi', error.message || 'Arşiv oluşturulamadı.');
    }
}

async function bulkShareSelected() {
    if (state.selectedFileIds.size === 0 || state.mode === 'trash') return;

    try {
        const result = await fetchJson('/shares/collections', {
            method: 'POST',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ file_ids: [...state.selectedFileIds] }),
        });
        const shareUrl = result?.share_url;
        if (!shareUrl) {
            throw new Error('Paylaşım sayfası üretilemedi.');
        }

        await Swal.fire({
            title: 'Paylaşım sayfası hazır',
            html: `<input class="swal2-input" style="width:100%;margin:0;" value="${escapeHtml(shareUrl)}" readonly>`,
            showCancelButton: true,
            showDenyButton: true,
            confirmButtonText: 'Kopyala',
            denyButtonText: 'Aç',
            cancelButtonText: 'Kapat',
            preConfirm: async () => {
                await navigator.clipboard.writeText(shareUrl);
            },
        }).then((dialogResult) => {
            if (dialogResult.isDenied) {
                window.open(shareUrl, '_blank', 'noopener');
            }
        });
    } catch (error) {
        toast('error', 'Toplu paylaşım başarısız', error.message || 'Paylaşım sayfası oluşturulamadı.');
    }
}

function startFileDrag(event, fileId) {
    state.draggedFileId = String(fileId);
    event.dataTransfer.setData('text/plain', String(fileId));
    event.dataTransfer.effectAllowed = 'move';
}

function endFileDrag() {
    state.draggedFileId = null;
    document.querySelectorAll('.item-card.drop-target').forEach((node) => node.classList.remove('drop-target'));
}

function handleFolderDragOver(event, folderId) {
    if (!state.draggedFileId || state.selectionMode || state.mode === 'trash') return;
    event.preventDefault();
    document.getElementById(`folder-card-${folderId}`)?.classList.add('drop-target');
}

function handleFolderDragLeave(event, folderId) {
    const target = document.getElementById(`folder-card-${folderId}`);
    if (target && !target.contains(event.relatedTarget)) {
        target.classList.remove('drop-target');
    }
}

async function handleFolderDrop(event, folderId) {
    event.preventDefault();
    const fileId = event.dataTransfer.getData('text/plain') || state.draggedFileId;
    endFileDrag();
    if (!fileId) return;

    const file = getFileById(fileId);
    const folder = state.folders.find((item) => String(item.id) === String(folderId));
    if (!file || !folder) return;

    try {
        await fetchJson(`/files/${fileId}/move`, {
            method: 'POST',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ folder_id: String(folderId) }),
        });
        await loadContent();
        toast('success', 'Dosya taşındı', `"${getDisplayName(file)}" ${folder.name} klasörüne taşındı.`);
    } catch (error) {
        toast('error', 'Taşıma başarısız', error.message || 'Dosya klasöre taşınamadı.');
    }
}

function openPreviewById(fileId) {
    const file = getFileById(fileId);
    if (!file) return;
    state.previewFile = file;
    renderPreview();
    document.getElementById('previewModal').classList.remove('hidden');
    document.getElementById('previewModal').classList.add('open');
}

function closePreview() {
    const stage = document.getElementById('previewStage');
    const video = stage.querySelector('video');
    if (video) video.pause();
    stage.innerHTML = '';
    state.previewFile = null;
    document.getElementById('previewModal').classList.remove('open');
    document.getElementById('previewModal').classList.add('hidden');
}

function renderPreview() {
    const file = state.previewFile;
    if (!file) return;

    const stage = document.getElementById('previewStage');
    const chips = document.getElementById('previewMetaChips');
    document.getElementById('previewTitle').textContent = getDisplayName(file);
    document.getElementById('previewSubtitle').textContent = file.filename || 'Dosya bilgisi';

    if (isImageFile(file) && !isPreviewBlocked(file)) {
        stage.innerHTML = `<img src="/preview/${encodeURIComponent(file.file_id)}?token=${encodeURIComponent(state.token)}" alt="${escapeHtml(getDisplayName(file))}">`;
        document.getElementById('previewNote').textContent = 'Görsel doğrudan Telegram önizleme akışından gösteriliyor.';
    } else if (isVideoFile(file) && !isPreviewBlocked(file)) {
        stage.innerHTML = `<video controls autoplay src="/stream/${encodeURIComponent(file.file_id)}?token=${encodeURIComponent(state.token)}"></video>`;
        document.getElementById('previewNote').textContent = 'Video akışı doğrudan oynatılıyor.';
    } else {
        const icon = getFileIconMeta(file);
        stage.innerHTML = `
            <div style="display:grid; place-items:center; text-align:center; gap:0.9rem; color:#fff;">
                <div class="leading-icon" style="width:84px;height:84px;background:${icon.bg};color:${icon.color};">
                    <span class="material-symbols-outlined" style="font-size:42px;">${icon.name}</span>
                </div>
                <div style="font-weight:800;font-size:1.1rem;">Önizleme mevcut değil</div>
                <div style="max-width:34ch;color:rgba(255,255,255,0.72);">Büyük veya parçalı dosyalarda önizleme kapatılır.</div>
            </div>
        `;
        document.getElementById('previewNote').textContent = 'Bu dosya için doğrudan indirme veya paylaşım kullanabilirsin.';
    }

    chips.innerHTML = [
        `<span class="meta-chip">${formatBytes(file.file_size)}</span>`,
        `<span class="meta-chip">${Number(file.download_count || 0)} indirme</span>`,
        file.is_favorite ? '<span class="tag-chip primary">Favori</span>' : '',
        file.is_chunked ? '<span class="tag-chip warning">Parçalı</span>' : '',
    ].filter(Boolean).join('');
}

async function downloadPreviewFile() {
    if (state.previewFile) {
        await downloadFile(state.previewFile);
    }
}

async function sharePreviewFile() {
    if (state.previewFile) {
        await shareFileLink(state.previewFile.id);
    }
}

async function renamePreviewFile() {
    if (state.previewFile) {
        await renameFile(state.previewFile.id);
    }
}

function emptyMarkup(icon, message) {
    return `
        <div class="empty-state">
            <div>
                <span class="material-symbols-outlined">${icon}</span>
                <div>${escapeHtml(message)}</div>
            </div>
        </div>
    `;
}

function getDisplayName(item) {
    return item?.display_name || item?.filename || item?.name || 'Dosya';
}

function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const value = Math.floor(Math.log(bytes) / Math.log(1024));
    const size = bytes / 1024 ** value;
    return `${size.toFixed(size >= 10 || value === 0 ? 0 : 1)} ${units[value]}`;
}

function getFileIconMeta(file) {
    const target = `${file?.mime_type || ''} ${file?.filename || ''}`.toLowerCase();
    if (target.includes('image') || /\.(png|jpe?g|gif|webp|heic|heif)$/i.test(target)) return { name: 'image', bg: '#dbeafe', color: '#2563eb' };
    if (target.includes('video') || /\.(mp4|mov|avi|mkv|webm)$/i.test(target)) return { name: 'movie', bg: '#ffedd5', color: '#ea580c' };
    if (target.includes('pdf')) return { name: 'picture_as_pdf', bg: '#fee2e2', color: '#dc2626' };
    if (target.includes('zip') || target.includes('rar')) return { name: 'folder_zip', bg: '#fef3c7', color: '#d97706' };
    if (target.includes('sheet') || target.includes('excel') || target.includes('csv')) return { name: 'table_view', bg: '#dcfce7', color: '#16a34a' };
    return { name: 'description', bg: '#ede9fe', color: '#7c3aed' };
}

function isImageFile(file) {
    const target = `${file?.mime_type || ''} ${file?.filename || ''}`.toLowerCase();
    return target.includes('image') || /\.(png|jpe?g|gif|webp|heic|heif)$/i.test(target);
}

function isVideoFile(file) {
    const target = `${file?.mime_type || ''} ${file?.filename || ''}`.toLowerCase();
    return target.includes('video') || /\.(mp4|mov|avi|mkv|webm)$/i.test(target);
}

function isPreviewBlocked(file) {
    return Boolean(file?.is_chunked) || Number(file?.file_size || 0) > PREVIEW_SIZE_LIMIT_BYTES;
}

function hexToRgba(hex, alpha) {
    const safe = (hex || '#3E577A').replace('#', '');
    if (safe.length !== 6) {
        return `rgba(62, 87, 122, ${alpha})`;
    }
    const value = Number.parseInt(safe, 16);
    const r = (value >> 16) & 255;
    const g = (value >> 8) & 255;
    const b = value & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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
