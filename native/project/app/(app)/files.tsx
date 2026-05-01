import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, Modal, TextInput, Share, StyleSheet, ActionSheetIOS, Platform, Image, ScrollView, Linking, Switch, Animated, PanResponder, Alert } from 'react-native';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useVideoPlayer, VideoView, type VideoSource } from 'expo-video';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { documentDirectory, createDownloadResumable } from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import api from '@/services/api';
import { appendUploadFile } from '@/services/uploadFormData';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Config from '@/constants/Config';
import { useAuthStore } from '@/store/authStore';
import { useUIStore } from '@/store/uiStore';

function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const value = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / 1024 ** value;
  return `${size.toFixed(size >= 10 || value === 0 ? 0 : 1)} ${units[value]}`;
}

function getFileIconMeta(name?: string, mimeType?: string) {
  const target = `${name || ''} ${mimeType || ''}`.toLowerCase();
  if (!target) {
    return { name: 'insert-drive-file' as const, bg: '#eef2ff', color: '#6366f1' };
  }
  if (target.includes('image') || target.match(/\.(png|jpg|jpeg|gif|webp)$/)) {
    return { name: 'image' as const, bg: '#dbeafe', color: '#2563eb' };
  }
  if (target.includes('video') || target.match(/\.(mp4|mov|avi|mkv|webm)$/)) {
    return { name: 'movie' as const, bg: '#ffedd5', color: '#ea580c' };
  }
  if (target.includes('pdf')) {
    return { name: 'picture-as-pdf' as const, bg: '#fee2e2', color: '#dc2626' };
  }
  if (target.includes('zip') || target.includes('rar') || target.includes('compressed')) {
    return { name: 'folder-zip' as const, bg: '#fef3c7', color: '#d97706' };
  }
  if (target.includes('sheet') || target.includes('excel') || target.includes('csv')) {
    return { name: 'table-view' as const, bg: '#dcfce7', color: '#16a34a' };
  }
  if (target.includes('word') || target.includes('document') || target.includes('text')) {
    return { name: 'description' as const, bg: '#dbeafe', color: '#2563eb' };
  }
  return { name: 'insert-drive-file' as const, bg: '#ede9fe', color: '#7c3aed' };
}

function getDisplayName(item: any) {
  return item?.display_name || item?.name || item?.filename || '';
}

function buildShareMessage(file: any, shareUrl: string) {
  const fileName = getDisplayName(file) || 'Dosya';
  return `Bu dosyayi indir:\n${fileName}\n${shareUrl}`;
}

function buildPickerFileName(asset: any) {
  if (asset?.fileName) {
    return asset.fileName;
  }

  const fromUri = asset?.uri?.split('/').pop();
  if (fromUri && fromUri.includes('.')) {
    return fromUri;
  }

  const extension = asset?.type === 'video' ? 'mp4' : 'jpg';
  return `media-${Date.now()}.${extension}`;
}

const PREVIEW_SIZE_LIMIT_BYTES = 20 * 1024 * 1024;
const FOLDER_COLOR_OPTIONS = ['#3E577A', '#2563EB', '#7C3AED', '#DB2777', '#EA580C', '#16A34A', '#D97706', '#475569'];
const FOLDER_ICON_OPTIONS = ['folder', 'folder-open', 'workspaces', 'photo-library', 'inventory-2', 'description'];

function hexToRgba(hex: string | undefined, alpha: number) {
  const safeHex = (hex || '#3E577A').replace('#', '');
  if (safeHex.length !== 6) {
    return `rgba(62, 87, 122, ${alpha})`;
  }

  const value = Number.parseInt(safeHex, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function isPreviewBlocked(item: any) {
  if (!item) {
    return false;
  }

  return Boolean(item?.is_chunked) || Number(item?.file_size || 0) > PREVIEW_SIZE_LIMIT_BYTES;
}

export default function FilesScreen() {
  const params = useLocalSearchParams();
  const router = useRouter();
  const navigation = useNavigation();
  const token = useAuthStore((state) => state.token);
  const isDarkMode = useUIStore((state) => state.isDarkMode);
  const insets = useSafeAreaInsets();
  
  const [files, setFiles] = useState<any[]>([]);
  const [folders, setFolders] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showUploadPicker, setShowUploadPicker] = useState(false);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [folderHistory, setFolderHistory] = useState<{id: string | null, name: string}[]>([{id: null, name: 'Home'}]);
  
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [isTrashMode, setIsTrashMode] = useState(false);
  const [isFavoritesMode, setIsFavoritesMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Modal States
  const [createFolderModal, setCreateFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderColor, setNewFolderColor] = useState(FOLDER_COLOR_OPTIONS[0]);
  const [newFolderIcon, setNewFolderIcon] = useState(FOLDER_ICON_OPTIONS[0]);
  
  // Preview State
  const [previewFile, setPreviewFile] = useState<any>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const [shareFile, setShareFile] = useState<any>(null);
  const [shareLink, setShareLink] = useState('');
  const [shareLoading, setShareLoading] = useState(false);
  const [renameEditorVisible, setRenameEditorVisible] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);
  const [shareExpiryEnabled, setShareExpiryEnabled] = useState(true);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState('Preparing upload...');
  const [activeUploadName, setActiveUploadName] = useState('Waiting for file');
  const [batchUploadTotal, setBatchUploadTotal] = useState(0);
  const [batchUploadIndex, setBatchUploadIndex] = useState(0);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedFileIds, setSelectedFileIds] = useState<number[]>([]);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [moveFolderOptions, setMoveFolderOptions] = useState<{ id: string | null; name: string; depth: number }[]>([]);
  const [moveLoading, setMoveLoading] = useState(false);
  const [draggingFile, setDraggingFile] = useState<any>(null);
  const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });
  const [hoveredFolderId, setHoveredFolderId] = useState<string | null>(null);
  const previewTranslateX = useRef(new Animated.Value(0)).current;
  const renameInputRef = useRef<TextInput | null>(null);
  const lastHandledUploadActionRef = useRef<string | null>(null);
  const lastHandledPreviewRequestRef = useRef<string | null>(null);
  const folderDropRefs = useRef<Record<string, any>>({});
  const folderDropLayouts = useRef<Record<string, { x: number; y: number; width: number; height: number }>>({});
  const dragStateRef = useRef<{ file: any; hoveredFolderId: string | null } | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ visible: boolean; tone: 'success' | 'error' | 'info'; title: string; message: string }>({
    visible: false,
    tone: 'info',
    title: '',
    message: '',
  });

  useEffect(() => {
    dragStateRef.current = draggingFile ? { file: draggingFile, hoveredFolderId } : null;
  }, [draggingFile, hoveredFolderId]);

  const closePreview = useCallback(() => {
    Animated.timing(previewTranslateX, {
      toValue: 420,
      duration: 180,
      useNativeDriver: true,
    }).start(() => {
      previewTranslateX.setValue(0);
      setRenameEditorVisible(false);
      setRenameValue('');
      setPreviewFile(null);
    });
  }, [previewTranslateX]);

  const previewPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) =>
          Math.abs(gestureState.dx) > 12 &&
          Math.abs(gestureState.dx) > Math.abs(gestureState.dy) &&
          gestureState.dx > 0,
        onPanResponderMove: (_, gestureState) => {
          previewTranslateX.setValue(Math.max(0, gestureState.dx));
        },
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dx > 90 || gestureState.vx > 0.7) {
            closePreview();
            return;
          }

          Animated.spring(previewTranslateX, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 0,
          }).start();
        },
        onPanResponderTerminate: () => {
          Animated.spring(previewTranslateX, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 0,
          }).start();
        },
      }),
    [closePreview, previewTranslateX]
  );

  useEffect(() => {
    const mode = typeof params.mode === 'string' ? params.mode : null;
    const favoritesMode = mode === 'favorites' || params.favorites === 'true';
    const trashMode = mode === 'trash' || params.trash === 'true';
    const requestedFolderId =
      typeof params.folder_id === 'string' && params.folder_id !== '' && params.folder_id !== 'root' && params.folder_id !== 'create'
        ? params.folder_id
        : null;

    setIsFavoritesMode(favoritesMode);
    setIsTrashMode(trashMode);
    setCurrentFolderId(requestedFolderId);
    setFolderHistory([{ id: null, name: 'Home' }]);
    setSearchQuery('');
    setPreviewFile(null);

    if (params.folder_id === 'create') {
      setNewFolderName('');
      setNewFolderColor(FOLDER_COLOR_OPTIONS[0]);
      setNewFolderIcon(FOLDER_ICON_OPTIONS[0]);
      setCreateFolderModal(true);
    }
  }, [params.favorites, params.trash, params.mode, params.folder_id, params.refresh]);

  useEffect(() => {
    const uploadActionKey = typeof params.refresh === 'string' ? params.refresh : 'upload';

    if (params.action === 'upload' && lastHandledUploadActionRef.current !== uploadActionKey) {
      lastHandledUploadActionRef.current = uploadActionKey;
      const timer = setTimeout(() => {
        handleUploadPress();
        router.replace('/(app)/files');
      }, 120);

      return () => clearTimeout(timer);
    }
  }, [params.action, params.refresh, router]);

  useEffect(() => {
    const previewFileId = typeof params.preview_file_id === 'string' ? params.preview_file_id : null;
    const refreshKey = typeof params.refresh === 'string' ? params.refresh : 'no-refresh';

    if (!previewFileId || files.length === 0) {
      return;
    }

    const requestKey = `${previewFileId}:${refreshKey}`;
    if (lastHandledPreviewRequestRef.current === requestKey) {
      return;
    }

    const matchedFile = files.find(
      (item) => String(item.file_id) === previewFileId || String(item.id) === previewFileId
    );

    if (!matchedFile) {
      return;
    }

    lastHandledPreviewRequestRef.current = requestKey;
    setPreviewFile(matchedFile);
  }, [files, params.preview_file_id, params.refresh]);

  useEffect(() => {
    if (!renameEditorVisible) {
      return;
    }

    const timer = setTimeout(() => {
      renameInputRef.current?.focus();
    }, 80);

    return () => clearTimeout(timer);
  }, [renameEditorVisible]);

  const loadContent = useCallback(async () => {
    setLoading(true);
    try {
      const queryParams = new URLSearchParams();
      
      if (currentFolderId) queryParams.append('folder_id', currentFolderId);
      if (isTrashMode) queryParams.append('trash', 'true');
      if (isFavoritesMode) queryParams.append('favorites', 'true');

      const [filesRes, foldersRes] = await Promise.all([
        api.get(`/files?${queryParams.toString()}`),
        api.get(`/folders?parent_id=${currentFolderId || 'root'}${isTrashMode ? '&trash=true' : ''}`)
      ]);

      setFiles(filesRes.data);
      // If filtering by favorites, we might not want to show folders unless we add favorite folders feature
      setFolders(isFavoritesMode ? [] : foldersRes.data);
    } catch (error) {
      console.error('Load content error', error);
    } finally {
      setLoading(false);
    }
  }, [currentFolderId, isTrashMode, isFavoritesMode]);

  useEffect(() => {
    loadContent();
  }, [loadContent]);

  useEffect(() => {
    setSelectionMode(false);
    setSelectedFileIds([]);
    setDraggingFile(null);
    setHoveredFolderId(null);
  }, [currentFolderId, isTrashMode, isFavoritesMode]);

  useFocusEffect(
    useCallback(() => {
      loadContent();
    }, [loadContent])
  );

  const measureFolderDropTarget = useCallback((folderId: string) => {
    const targetRef = folderDropRefs.current[folderId];
    if (!targetRef?.measureInWindow) {
      return;
    }

    targetRef.measureInWindow((x: number, y: number, width: number, height: number) => {
      folderDropLayouts.current[folderId] = { x, y, width, height };
    });
  }, []);

  const refreshFolderDropTargets = useCallback(() => {
    Object.keys(folderDropRefs.current).forEach((folderId) => measureFolderDropTarget(folderId));
  }, [measureFolderDropTarget]);

  useEffect(() => {
    const timer = setTimeout(() => {
      refreshFolderDropTargets();
    }, 80);

    return () => clearTimeout(timer);
  }, [folders, refreshFolderDropTargets, viewMode]);

  const findHoveredFolder = useCallback((x: number, y: number) => {
    const matchedEntry = Object.entries(folderDropLayouts.current).find(([, layout]) => (
      x >= layout.x &&
      x <= layout.x + layout.width &&
      y >= layout.y &&
      y <= layout.y + layout.height
    ));

    return matchedEntry?.[0] ?? null;
  }, []);

  const moveFileToFolder = useCallback(async (file: any, folderId: string | null, folderName?: string) => {
    await api.post(`/files/${file.id}/move`, { folder_id: folderId });
    await loadContent();
    setStatusMessage({
      visible: true,
      tone: 'success',
      title: 'Dosya tasindi',
      message: `"${getDisplayName(file)}" ${folderName || 'Home'} klasorune tasindi.`,
    });
  }, [loadContent]);

  const startFileDrag = useCallback((file: any, x: number, y: number) => {
    if (selectionMode || isTrashMode) {
      return;
    }

    refreshFolderDropTargets();
    setDraggingFile(file);
    setDragPosition({ x, y });
    setHoveredFolderId(findHoveredFolder(x, y));
  }, [findHoveredFolder, isTrashMode, refreshFolderDropTargets, selectionMode]);

  const finishFileDrag = useCallback(async () => {
    const activeDrag = dragStateRef.current;
    setDraggingFile(null);
    setHoveredFolderId(null);

    if (!activeDrag?.file || !activeDrag.hoveredFolderId) {
      return;
    }

    const folder = folders.find((item) => String(item.id) === activeDrag.hoveredFolderId);
    try {
      await moveFileToFolder(activeDrag.file, activeDrag.hoveredFolderId, folder?.name);
    } catch {
      setStatusMessage({
        visible: true,
        tone: 'error',
        title: 'Tasima basarisiz',
        message: 'Dosya secilen klasore tasinamadi.',
      });
    }
  }, [folders, moveFileToFolder]);

  const buildDragHandlePanHandlers = useCallback((file: any) => PanResponder.create({
    onStartShouldSetPanResponder: () => !selectionMode && !isTrashMode,
    onMoveShouldSetPanResponder: (_, gestureState) =>
      !selectionMode &&
      !isTrashMode &&
      (Math.abs(gestureState.dx) > 6 || Math.abs(gestureState.dy) > 6),
    onPanResponderGrant: (event) => {
      startFileDrag(file, event.nativeEvent.pageX, event.nativeEvent.pageY);
    },
    onPanResponderMove: (event) => {
      const nextX = event.nativeEvent.pageX;
      const nextY = event.nativeEvent.pageY;
      setDragPosition({ x: nextX, y: nextY });
      setHoveredFolderId(findHoveredFolder(nextX, nextY));
    },
    onPanResponderRelease: () => {
      void finishFileDrag();
    },
    onPanResponderTerminate: () => {
      void finishFileDrag();
    },
  }).panHandlers, [findHoveredFolder, finishFileDrag, isTrashMode, selectionMode, startFileDrag]);

  const handleCreateFolder = async () => {
    if (!newFolderName) return;
    try {
      await api.post('/folders', {
        name: newFolderName,
        color: newFolderColor,
        icon: newFolderIcon,
        parent_id: currentFolderId,
      });
      setCreateFolderModal(false);
      setNewFolderName('');
      setNewFolderColor(FOLDER_COLOR_OPTIONS[0]);
      setNewFolderIcon(FOLDER_ICON_OPTIONS[0]);
      loadContent();
    } catch {
      setStatusMessage({
        visible: true,
        tone: 'error',
        title: 'Klasor hatasi',
        message: 'Klasor olusturulamadi.',
      });
    }
  };

  const closeCreateFolderModal = useCallback(() => {
    setCreateFolderModal(false);
    setNewFolderName('');
    setNewFolderColor(FOLDER_COLOR_OPTIONS[0]);
    setNewFolderIcon(FOLDER_ICON_OPTIONS[0]);
  }, []);

  const uploadFile = async (
    uri: string,
    name: string,
    mimeType: string,
    batchMeta?: { index: number; total: number; isLast: boolean }
  ) => {
      const formData = new FormData();
      appendUploadFile(formData, {
        uri,
        name,
        mimeType,
      });
      if (currentFolderId) {
        formData.append('folder_id', currentFolderId);
      }

      setActiveUploadName(name);
      setBatchUploadTotal(batchMeta?.total ?? 1);
      setBatchUploadIndex((batchMeta?.index ?? 0) + 1);
      setUploadStatus(
        batchMeta?.total && batchMeta.total > 1
          ? `${(batchMeta.index ?? 0) + 1}/${batchMeta.total} hazirlaniyor...`
          : 'Preparing upload...'
      );
      setUploadProgress(0.12);
      setUploading(true);
      try {
        setUploadStatus(
          batchMeta?.total && batchMeta.total > 1
            ? `${(batchMeta.index ?? 0) + 1}/${batchMeta.total} yukleniyor...`
            : 'Uploading to secure storage...'
        );
        setUploadProgress(0.55);
        const response = await fetch(`${Config.API_URL}/upload`, {
          method: 'POST',
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            Accept: 'application/json',
            'Content-Type': 'multipart/form-data',
          },
          body: formData,
        });
        const rawText = await response.text();
        let payload: any = null;
        if (rawText) {
          try {
            payload = JSON.parse(rawText);
          } catch {
            payload = { error: rawText };
          }
        }
        if (!response.ok) {
          throw new Error(payload?.error || payload?.message || `Upload failed (${response.status})`);
        }
        setUploadStatus('Finalizing upload...');
        setUploadProgress(1);
        loadContent();
        if (!batchMeta) {
          setStatusMessage({
            visible: true,
            tone: 'success',
            title: 'Upload Complete',
            message: `${name} basariyla yuklendi.`,
          });
        }
      } catch (error: any) {
        console.error(error);
        setStatusMessage({
          visible: true,
          tone: 'error',
          title: 'Upload Failed',
          message: error.message || 'Could not upload file.',
        });
      } finally {
        if (!batchMeta || batchMeta.isLast) {
          setUploading(false);
          setUploadProgress(0);
          setUploadStatus('Preparing upload...');
          setActiveUploadName('Waiting for file');
          setBatchUploadTotal(0);
          setBatchUploadIndex(0);
        }
      }
  };

  const pickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: true,
      });

      if (result.canceled) return;
      if (result.assets.length > 1) {
        setStatusMessage({
          visible: true,
          tone: 'info',
          title: 'Toplu yukleme',
          message: `${result.assets.length} dosya secildi ve sira ile yuklenecek.`,
        });
      }
      for (const [index, asset] of result.assets.entries()) {
        await uploadFile(asset.uri, asset.name, asset.mimeType || 'application/octet-stream', {
          index,
          total: result.assets.length,
          isLast: index === result.assets.length - 1,
        });
      }
    } catch (err) {
        console.log(err);
    }
  };

  const pickImage = async () => {
    try {
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images', 'videos'],
            allowsMultipleSelection: true,
            quality: 1,
        });

        if (!result.canceled) {
            if (result.assets.length > 1) {
                setStatusMessage({
                  visible: true,
                  tone: 'info',
                  title: 'Toplu yukleme',
                  message: `${result.assets.length} medya secildi ve sira ile yuklenecek.`,
                });
            }
            for (const [index, asset] of result.assets.entries()) {
                const filename = buildPickerFileName(asset);
                const type = asset.mimeType || (asset.type === 'video' ? 'video/mp4' : 'image/jpeg');
                await uploadFile(asset.uri, filename, type, {
                  index,
                  total: result.assets.length,
                  isLast: index === result.assets.length - 1,
                });
            }
        }
    } catch (err) {
        console.log(err);
    }
  };

  const handleUploadPress = () => {
    if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options: ['Cancel', 'Photo/Video Library', 'Document Browser'],
            cancelButtonIndex: 0,
          },
          (buttonIndex) => {
            if (buttonIndex === 1) {
                pickImage();
            } else if (buttonIndex === 2) {
                pickDocument();
            }
          }
        );
    } else {
        setShowUploadPicker(true);
    }
  };

  const handleFolderPress = (folder: any) => {
    setCurrentFolderId(folder.id);
    setFolderHistory([...folderHistory, { id: folder.id, name: folder.name }]);
  };

  const handleBackPress = () => {
    if (folderHistory.length > 1) {
      const newHistory = [...folderHistory];
      newHistory.pop();
      setFolderHistory(newHistory);
      setCurrentFolderId(newHistory[newHistory.length - 1].id);
      return;
    }

    if (navigation.canGoBack()) {
      router.back();
      return;
    }

    router.replace('/(app)/dashboard');
  };

  const handleBreadcrumbPress = (index: number) => {
    const nextHistory = folderHistory.slice(0, index + 1);
    setFolderHistory(nextHistory);
    setCurrentFolderId(nextHistory[nextHistory.length - 1].id);
  };

  const handleModeChange = (mode: 'all' | 'favorites' | 'trash') => {
    setFolderHistory([{ id: null, name: 'Home' }]);
    setCurrentFolderId(null);
    setIsFavoritesMode(mode === 'favorites');
    setIsTrashMode(mode === 'trash');
  };

  const selectedFiles = useMemo(
    () => files.filter((file) => selectedFileIds.includes(file.id)),
    [files, selectedFileIds]
  );

  const buildDownloadFileName = useCallback((file: any) => {
    const baseName = file?.filename || getDisplayName(file) || `file-${file?.id || Date.now()}`;
    return baseName.replace(/[\\/:*?"<>|]/g, '_');
  }, []);

  const downloadFile = useCallback(async (
    file: any,
    options?: { shareAfterDownload?: boolean; reportProgress?: boolean; showSavedMessage?: boolean }
  ) => {
    const shareAfterDownload = options?.shareAfterDownload ?? true;
    const reportProgress = options?.reportProgress ?? true;
    const showSavedMessage = options?.showSavedMessage ?? !shareAfterDownload;

    if (reportProgress) {
      setIsDownloading(true);
      setDownloadProgress(0);
    }
    
    try {
        if (!documentDirectory) {
            throw new Error('Device storage not available');
        }
        const fileUri = documentDirectory + buildDownloadFileName(file);
        const downloadUrl = `${api.defaults.baseURL}/download/${file.file_id}`;
        
        const downloadResumable = createDownloadResumable(
            downloadUrl,
            fileUri,
            {
              headers: token ? { Authorization: `Bearer ${token}` } : {},
            },
            (progressEvent) => {
                if (!reportProgress) {
                  return;
                }
                const total = progressEvent.totalBytesExpectedToWrite || 1;
                const progress = progressEvent.totalBytesWritten / total;
                setDownloadProgress(progress);
            }
        );

        const result = await downloadResumable.downloadAsync();
        
        if (result && result.uri) {
            if (shareAfterDownload && await Sharing.isAvailableAsync()) {
                await Sharing.shareAsync(result.uri);
            } else if (showSavedMessage) {
                setStatusMessage({
                  visible: true,
                  tone: 'success',
                  title: 'Download Complete',
                  message: 'File saved to ' + result.uri,
                });
            }
            return result.uri;
        }

        throw new Error('Download result missing');
    } catch (error) {
        console.error(error);
        if (reportProgress || showSavedMessage) {
          setStatusMessage({
            visible: true,
            tone: 'error',
            title: 'Download Failed',
            message: 'File could not be downloaded.',
          });
        }
        throw error;
    } finally {
        if (reportProgress) {
          setIsDownloading(false);
          setDownloadProgress(0);
        }
    }
  }, [buildDownloadFileName, token]);

  const handleBulkDownload = useCallback(async () => {
    if (selectedFiles.length === 0) {
      return;
    }

    try {
      setIsDownloading(true);
      setDownloadProgress(0);
      for (const [index, file] of selectedFiles.entries()) {
        setStatusMessage({
          visible: true,
          tone: 'info',
          title: 'Toplu indirme',
          message: `${index + 1}/${selectedFiles.length} indiriliyor: ${getDisplayName(file)}`,
        });
        await downloadFile(file, {
          shareAfterDownload: false,
          reportProgress: true,
          showSavedMessage: false,
        });
      }

      setStatusMessage({
        visible: true,
        tone: 'success',
        title: 'Toplu indirme tamamlandi',
        message: `${selectedFiles.length} dosya cihaza indirildi.`,
      });
    } catch {
      setStatusMessage({
        visible: true,
        tone: 'error',
        title: 'Toplu indirme basarisiz',
        message: 'Secilen dosyalarin tamami indirilemedi.',
      });
    } finally {
      setIsDownloading(false);
      setDownloadProgress(0);
    }
  }, [downloadFile, selectedFiles]);

  const loadMoveFolderOptions = useCallback(async () => {
    const collected: { id: string | null; name: string; depth: number }[] = [{ id: null, name: 'Home', depth: 0 }];

    const walkFolders = async (parentId: string | null, depth: number) => {
      const response = await api.get(`/folders?parent_id=${parentId || 'root'}`);
      const folderItems = response.data as any[];
      for (const folder of folderItems) {
        collected.push({ id: String(folder.id), name: folder.name, depth });
        await walkFolders(String(folder.id), depth + 1);
      }
    };

    await walkFolders(null, 1);
    setMoveFolderOptions(collected);
  }, []);

  const openMoveModal = useCallback(async () => {
    if (selectedFileIds.length === 0 || isTrashMode) {
      return;
    }

    try {
      setMoveLoading(true);
      await loadMoveFolderOptions();
      setShowMoveModal(true);
    } catch {
      setStatusMessage({
        visible: true,
        tone: 'error',
        title: 'Klasorler yuklenemedi',
        message: 'Tasima icin hedef klasorler getirilemedi.',
      });
    } finally {
      setMoveLoading(false);
    }
  }, [isTrashMode, loadMoveFolderOptions, selectedFileIds.length]);

  const moveSelectedFilesToFolder = useCallback(async (folderId: string | null, folderName?: string) => {
    if (selectedFileIds.length === 0) {
      return;
    }

    try {
      await Promise.all(
        selectedFileIds.map((fileId) =>
          api.post(`/files/${fileId}/move`, { folder_id: folderId })
        )
      );
      setShowMoveModal(false);
      clearSelection();
      await loadContent();
      setStatusMessage({
        visible: true,
        tone: 'success',
        title: 'Dosyalar tasindi',
        message: `${selectedFileIds.length} dosya ${folderName || 'Home'} klasorune tasindi.`,
      });
    } catch {
      setStatusMessage({
        visible: true,
        tone: 'error',
        title: 'Tasima basarisiz',
        message: 'Secilen dosyalar tasinamadi.',
      });
    }
  }, [clearSelection, loadContent, selectedFileIds]);

  const openShareSheet = async (file: any) => {
    try {
      setShareLoading(true);
      setShareFile(file);
      const response = await api.post(`/files/${file.id}/share-link`);
      const shareUrl = response.data?.share_url;
      if (!shareUrl) {
        setStatusMessage({
          visible: true,
          tone: 'error',
          title: 'Share Unavailable',
          message: 'Secure share link could not be created.',
        });
        return;
      }
      setShareLink(shareUrl);
    } catch (error) {
      console.error(error);
      setStatusMessage({
        visible: true,
        tone: 'error',
        title: 'Share Failed',
        message: 'Could not open the share sheet.',
      });
      setShareFile(null);
      setShareLink('');
    } finally {
      setShareLoading(false);
    }
  };

  const openRenameEditor = useCallback((file: any) => {
    setRenameValue(getDisplayName(file));
    setRenameEditorVisible(true);
  }, []);

  const handleRenameFile = useCallback(async () => {
    if (!previewFile || !renameValue.trim()) {
      return;
    }

    try {
      setRenameSaving(true);
      const nextDisplayName = renameValue.trim();
      await api.post(`/files/${previewFile.id}/rename`, { display_name: nextDisplayName });

      setFiles((current) =>
        current.map((item) =>
          item.id === previewFile.id ? { ...item, display_name: nextDisplayName } : item
        )
      );
      setPreviewFile((current: any) =>
        current && current.id === previewFile.id ? { ...current, display_name: nextDisplayName } : current
      );
      setShareFile((current: any) =>
        current && current.id === previewFile.id ? { ...current, display_name: nextDisplayName } : current
      );
      setRenameEditorVisible(false);
    } catch (error: any) {
      setStatusMessage({
        visible: true,
        tone: 'error',
        title: 'Rename Failed',
        message: error.response?.data?.error || 'File name could not be updated.',
      });
    } finally {
      setRenameSaving(false);
    }
  }, [previewFile, renameValue]);

  const handleFolderAction = async (folder: any, action: 'delete' | 'restore' | 'permanent_delete') => {
    if (action === 'delete') {
      Alert.alert(
        'Klasoru sil',
        `"${folder.name}" klasorunu cop kutusuna tasimak istiyor musun?`,
        [
          { text: 'Hayir', style: 'cancel' },
          { text: 'Evet', style: 'destructive', onPress: () => void handleFolderActionConfirmed(folder, action) },
        ]
      );
      return;
    }
    if (action === 'permanent_delete') {
      Alert.alert(
        'Klasoru kalici sil',
        `"${folder.name}" klasoru ve icindeki dosyalar Telegram'dan da kalici olarak silinecek. Devam etmek istiyor musun?`,
        [
          { text: 'Hayir', style: 'cancel' },
          { text: 'Kalici sil', style: 'destructive', onPress: () => void handleFolderActionConfirmed(folder, action) },
        ]
      );
      return;
    }
    await handleFolderActionConfirmed(folder, action);
  };

  const handleFolderActionConfirmed = async (folder: any, action: 'delete' | 'restore' | 'permanent_delete') => {
    try {
      if (action === 'delete') {
        await api.post(`/folders/${folder.id}/trash`);
      } else if (action === 'restore') {
        await api.post(`/folders/${folder.id}/trash`, { restore: true });
      } else {
        await api.delete(`/folders/${folder.id}/trash`);
      }
      await loadContent();
    } catch {
      setStatusMessage({
        visible: true,
        tone: 'error',
        title: 'Folder Action Failed',
        message: 'Folder action could not be completed.',
      });
    }
  };

  const toggleFileSelection = useCallback((fileId: number) => {
    setSelectedFileIds((current) =>
      current.includes(fileId) ? current.filter((id) => id !== fileId) : [...current, fileId]
    );
  }, []);

  const clearSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedFileIds([]);
  }, []);

  const confirmBulkDelete = useCallback(() => {
    if (selectedFileIds.length === 0) {
      return;
    }

    Alert.alert(
      isTrashMode ? 'Secilen dosyalari kalici sil' : 'Secilen dosyalari sil',
      isTrashMode
        ? `${selectedFileIds.length} dosya Telegram'dan da kalici olarak silinecek. Devam etmek istiyor musun?`
        : `${selectedFileIds.length} dosyayi cop kutusuna tasimak istiyor musun?`,
      [
        { text: 'Hayir', style: 'cancel' },
        {
          text: isTrashMode ? 'Kalici sil' : 'Evet',
          style: 'destructive',
          onPress: () => void handleBulkDeleteConfirmed(),
        },
      ]
    );
  }, [isTrashMode, selectedFileIds]);

  const handleBulkDeleteConfirmed = useCallback(async () => {
    try {
      const selectedFiles = files.filter((file) => selectedFileIds.includes(file.id));
      if (isTrashMode) {
        await Promise.all(selectedFiles.map((file) => api.delete(`/files/${file.id}/trash`)));
      } else {
        await Promise.all(selectedFileIds.map((fileId) => api.post(`/files/${fileId}/trash`)));
      }
      clearSelection();
      await loadContent();
      setStatusMessage({
        visible: true,
        tone: 'success',
        title: isTrashMode ? 'Dosyalar kalici silindi' : 'Dosyalar silindi',
        message: isTrashMode
          ? 'Secilen dosyalar Telegram dahil kalici olarak silindi.'
          : 'Secilen dosyalar cop kutusuna tasindi.',
      });
    } catch {
      setStatusMessage({
        visible: true,
        tone: 'error',
        title: isTrashMode ? 'Kalici silme basarisiz' : 'Toplu silme basarisiz',
        message: isTrashMode
          ? 'Secilen dosyalar kalici olarak silinemedi.'
          : 'Secilen dosyalar silinemedi.',
      });
    }
  }, [clearSelection, files, isTrashMode, loadContent, selectedFileIds]);

  const handleFileAction = async (file: any, action: string) => {
    if (action === 'delete') {
      Alert.alert(
        'Dosyayi sil',
        `"${getDisplayName(file)}" dosyasini cop kutusuna tasimak istiyor musun?`,
        [
          { text: 'Hayir', style: 'cancel' },
          { text: 'Evet', style: 'destructive', onPress: () => void handleFileActionConfirmed(file, action) },
        ]
      );
      return;
    }
    if (action === 'permanent_delete') {
      Alert.alert(
        'Dosyayi kalici sil',
        `"${getDisplayName(file)}" dosyasi Telegram'dan da kalici olarak silinecek. Devam etmek istiyor musun?`,
        [
          { text: 'Hayir', style: 'cancel' },
          { text: 'Kalici sil', style: 'destructive', onPress: () => void handleFileActionConfirmed(file, action) },
        ]
      );
      return;
    }
    await handleFileActionConfirmed(file, action);
  };

  const handleFileActionConfirmed = async (file: any, action: string) => {
    try {
      if (action === 'delete') {
         await api.post(`/files/${file.id}/trash`);
      } else if (action === 'restore') {
         await api.post(`/files/${file.id}/trash`, { restore: true });
      } else if (action === 'permanent_delete') {
         await api.delete(`/files/${file.id}/trash`);
      } else if (action === 'favorite') {
         await api.post(`/files/${file.id}/favorite`);
      } else if (action === 'download') {
         await downloadFile(file);
         return;
      } else if (action === 'share') {
         await openShareSheet(file);
         return;
      }
      await loadContent();
    } catch {
      setStatusMessage({
        visible: true,
        tone: 'error',
        title: 'Action Failed',
        message: 'The selected action could not be completed.',
      });
    }
  };

  const filteredData = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const data = [...folders, ...files];
    if (!query) return data;

    return data.filter((item) => {
      const label = getDisplayName(item).toLowerCase();
      return label.includes(query);
    });
  }, [files, folders, searchQuery]);

  const previewMimeType = previewFile?.mime_type || '';
  const isPreviewImage =
    previewMimeType.includes('image') ||
    /\.(png|jpg|jpeg|gif|webp)$/i.test(previewFile?.filename || previewFile?.display_name || '');
  const isPreviewVideo =
    previewMimeType.includes('video') ||
    /\.(mp4|mov|avi|mkv|webm)$/i.test(previewFile?.filename || previewFile?.display_name || '');
  const previewBlocked = isPreviewBlocked(previewFile) && (isPreviewImage || isPreviewVideo);
  const previewStreamHeaders = token ? { Authorization: `Bearer ${token}` } : undefined;
  const previewVideoSource: VideoSource | null = useMemo(() => {
    if (!isPreviewVideo || !previewFile?.file_id || previewBlocked) {
      return null;
    }

    return {
      uri: `${Config.API_URL}/stream/${previewFile.file_id}`,
      headers: previewStreamHeaders,
    };
  }, [isPreviewVideo, previewBlocked, previewFile?.file_id, previewStreamHeaders]);
  const previewVideoPlayer = useVideoPlayer(previewVideoSource, (player) => {
    player.loop = false;
    player.showNowPlayingNotification = false;
  });

  const renderItem = ({ item, index }: any) => {
    const isFolder = item.hasOwnProperty('parent_id'); // Simple check
    const itemName = getDisplayName(item);
    const itemType = item.mime_type || '';
    const isImage =
      !isFolder &&
      (itemType.includes('image') || /\.(png|jpg|jpeg|gif|webp)$/i.test(itemName));
    const shouldRenderThumb = isImage && !isPreviewBlocked(item);
    const fileIcon = !isFolder ? getFileIconMeta(itemName, itemType) : null;
    const isSelected = !isFolder && selectedFileIds.includes(item.id);
    const folderColor = isFolder ? (item.color || '#3E577A') : '#3E577A';
    const folderIconName = isFolder ? (item.icon || 'folder') : 'folder';
    const isDropTarget = isFolder && hoveredFolderId === String(item.id);
    const dragHandlePanHandlers = !isFolder ? buildDragHandlePanHandlers(item) : undefined;
    
    // Construct preview URL if it's an image
    // Note: Use file_id (Telegram ID) for the preview endpoint
    const previewUrl = shouldRenderThumb ? `${Config.API_URL}/preview/${item.file_id}` : '';

    return (
      <TouchableOpacity 
        ref={isFolder ? (node) => {
          folderDropRefs.current[String(item.id)] = node;
        } : undefined}
        style={[
          styles.itemContainer,
          isDarkMode && styles.surfaceDark,
          isDarkMode && styles.borderDark,
          viewMode === 'grid' && styles.gridItemContainer,
          isSelected && styles.itemContainerSelected,
          isDropTarget && styles.folderDropTargetActive,
        ]}
        onLayout={() => {
          if (isFolder) {
            requestAnimationFrame(() => measureFolderDropTarget(String(item.id)));
          }
        }}
        onPress={() => {
          if (!isFolder && selectionMode) {
            toggleFileSelection(item.id);
            return;
          }
          if (isFolder && selectionMode && !isTrashMode && selectedFileIds.length > 0) {
            void moveSelectedFilesToFolder(String(item.id), item.name);
            return;
          }
          isFolder ? handleFolderPress(item) : setPreviewFile(item);
        }}
        onLongPress={() => {
          if (!isFolder && !isTrashMode) {
            setSelectionMode(true);
            toggleFileSelection(item.id);
          }
        }}
      >
        {isFolder ? (
          <View
            style={[
              styles.folderIconWrap,
              { backgroundColor: hexToRgba(folderColor, 0.16), borderColor: hexToRgba(folderColor, 0.28) },
              viewMode === 'grid' && styles.gridFolderIconWrap,
            ]}
          >
            <MaterialIcons 
              name={folderIconName as any}
              size={viewMode === 'grid' ? 30 : 24}
              color={folderColor}
              style={[styles.leadingIcon, styles.folderLeadingIcon, viewMode === 'grid' && styles.gridLeadingIcon]}
            />
          </View>
        ) : (
            shouldRenderThumb ? (
                <Image 
                    source={{ uri: previewUrl }} 
                    style={[styles.previewThumb, viewMode === 'grid' && styles.gridPreviewThumb]}
                    resizeMode="cover"
                />
            ) : (
                <View
                  style={[
                    styles.fileTypeIconWrap,
                    { backgroundColor: fileIcon?.bg },
                    viewMode === 'grid' ? styles.gridFileTypeIconWrap : null,
                  ]}
                >
                  <MaterialIcons
                    name={fileIcon?.name || 'insert-drive-file'}
                    size={viewMode === 'grid' ? 30 : 24}
                    color={fileIcon?.color || '#666'}
                  />
                </View>
            )
        )}
        
        <View style={[styles.itemContent, viewMode === 'grid' && styles.gridItemContent]}>
          <Text style={[styles.itemName, isDarkMode && styles.primaryTextDark]} numberOfLines={1}>
            {getDisplayName(item)}
          </Text>
          {!isFolder && (
            <Text style={[styles.itemMeta, isDarkMode && styles.secondaryTextDark]}>
              {formatBytes(item.file_size)} • {new Date(item.upload_date).toLocaleDateString()}
            </Text>
          )}
        </View>
        {!isFolder && selectionMode ? (
          <View style={[styles.selectionBadge, isSelected && styles.selectionBadgeActive]}>
            <MaterialIcons name={isSelected ? 'check' : 'circle'} size={18} color={isSelected ? '#ffffff' : '#94a3b8'} />
          </View>
        ) : null}
        {!isFolder ? (
          <View style={[styles.itemActions, viewMode === 'grid' && styles.gridItemActions]}>
            {!isTrashMode && !selectionMode ? (
              <View
                {...dragHandlePanHandlers}
                style={[
                  styles.iconButton,
                  styles.dragHandleButton,
                  isDarkMode && styles.subtleDark,
                  isDarkMode && styles.borderDark,
                  draggingFile?.id === item.id && styles.dragHandleActive,
                ]}
              >
                <MaterialIcons name="drag-indicator" size={18} color="#64748b" />
              </View>
            ) : null}
            {!isTrashMode && !selectionMode ? (
              <TouchableOpacity onPress={() => handleFileAction(item, 'favorite')} style={[styles.iconButton, isDarkMode && styles.subtleDark, isDarkMode && styles.borderDark]}>
                <MaterialIcons name={item.is_favorite ? 'star' : 'star-border'} size={20} color="#eab308" />
              </TouchableOpacity>
            ) : null}
            {!isTrashMode && !selectionMode ? (
              <TouchableOpacity onPress={() => handleFileAction(item, 'share')} style={[styles.iconButton, isDarkMode && styles.subtleDark, isDarkMode && styles.borderDark]}>
                <MaterialIcons name="share" size={18} color="#3e577a" />
              </TouchableOpacity>
            ) : null}
            {!selectionMode ? (
            <TouchableOpacity onPress={() => handleFileAction(item, 'download')} style={[styles.iconButton, isDarkMode && styles.subtleDark, isDarkMode && styles.borderDark]}>
              <MaterialIcons name="download" size={18} color="#10b981" />
            </TouchableOpacity>
            ) : null}
            {!selectionMode ? (
            <TouchableOpacity onPress={() => handleFileAction(item, isTrashMode ? 'restore' : 'delete')} style={[styles.iconButton, isDarkMode && styles.subtleDark, isDarkMode && styles.borderDark]}>
              <MaterialIcons name={isTrashMode ? 'restore' : 'delete-outline'} size={18} color={isTrashMode ? '#3e577a' : '#ef4444'} />
            </TouchableOpacity>
            ) : null}
            {!selectionMode && isTrashMode ? (
            <TouchableOpacity onPress={() => handleFileAction(item, 'permanent_delete')} style={[styles.iconButton, isDarkMode && styles.subtleDark, isDarkMode && styles.borderDark]}>
              <MaterialIcons name="delete-forever" size={20} color="#ef4444" />
            </TouchableOpacity>
            ) : null}
          </View>
        ) : (
          <View style={[styles.itemActions, viewMode === 'grid' && styles.gridItemActions]}>
            <TouchableOpacity onPress={() => handleFolderAction(item, isTrashMode ? 'restore' : 'delete')} style={[styles.iconButton, isDarkMode && styles.subtleDark, isDarkMode && styles.borderDark]}>
              <MaterialIcons name={isTrashMode ? 'restore' : 'delete-outline'} size={18} color={isTrashMode ? '#3e577a' : '#ef4444'} />
            </TouchableOpacity>
            {isTrashMode ? (
              <TouchableOpacity onPress={() => handleFolderAction(item, 'permanent_delete')} style={[styles.iconButton, isDarkMode && styles.subtleDark, isDarkMode && styles.borderDark]}>
                <MaterialIcons name="delete-forever" size={20} color="#ef4444" />
              </TouchableOpacity>
            ) : null}
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={[styles.safeArea, isDarkMode && styles.safeAreaDark]} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={[styles.header, isDarkMode && styles.headerDark]}>
        {(folderHistory.length > 1 || navigation.canGoBack()) && (
          <TouchableOpacity onPress={handleBackPress} style={[styles.headerIconButton, isDarkMode && styles.surfaceDark, isDarkMode && styles.borderDark]}>
            <MaterialIcons name="arrow-back" size={24} color={isDarkMode ? '#f8fafc' : '#333'} />
          </TouchableOpacity>
        )}
        <Text style={[styles.headerTitle, isDarkMode && styles.primaryTextDark]}>
          {selectionMode
            ? `${selectedFileIds.length} secildi`
            : isFavoritesMode ? 'Favorites' : (isTrashMode ? 'Trash' : folderHistory[folderHistory.length - 1].name)}
        </Text>
        <View style={styles.headerActions}>
           {selectionMode ? (
             <>
               <TouchableOpacity onPress={() => setSelectedFileIds(files.map((file) => file.id))}>
                 <MaterialIcons name="select-all" size={24} color="#3e577a" />
               </TouchableOpacity>
               <TouchableOpacity onPress={() => void handleBulkDownload()} disabled={selectedFileIds.length === 0 || moveLoading}>
                 <MaterialIcons name="download-for-offline" size={24} color={selectedFileIds.length === 0 ? '#9ca3af' : '#10b981'} />
               </TouchableOpacity>
               {!isTrashMode ? (
                 <TouchableOpacity onPress={() => void openMoveModal()} disabled={selectedFileIds.length === 0 || moveLoading}>
                   <MaterialIcons name="drive-file-move" size={24} color={selectedFileIds.length === 0 ? '#9ca3af' : '#3e577a'} />
                 </TouchableOpacity>
               ) : null}
               <TouchableOpacity onPress={confirmBulkDelete} disabled={selectedFileIds.length === 0}>
                 <MaterialIcons name="delete-sweep" size={24} color={selectedFileIds.length === 0 ? '#9ca3af' : '#ef4444'} />
               </TouchableOpacity>
               <TouchableOpacity onPress={clearSelection}>
                 <MaterialIcons name="close" size={24} color="#3e577a" />
               </TouchableOpacity>
             </>
           ) : (
             <>
           {!isTrashMode && !isFavoritesMode && (
             <TouchableOpacity onPress={() => setCreateFolderModal(true)}>
               <MaterialIcons name="create-new-folder" size={24} color="#3e577a" />
             </TouchableOpacity>
           )}
           <TouchableOpacity onPress={loadContent}>
             <MaterialIcons name="refresh" size={24} color="#3e577a" />
           </TouchableOpacity>
             </>
           )}
        </View>
      </View>

      <View style={[styles.toolbar, isDarkMode && styles.headerDark]}>
        <View style={[styles.searchBox, isDarkMode && styles.surfaceDark, isDarkMode && styles.borderDark]}>
          <MaterialIcons name="search" size={20} color="#6b7280" />
          <TextInput
            style={[styles.searchInput, isDarkMode && styles.primaryTextDark]}
            placeholder="Search files and folders"
            placeholderTextColor="#9ca3af"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <MaterialIcons name="close" size={18} color={isDarkMode ? '#cbd5e1' : '#6b7280'} />
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.modeRow}>
          <TouchableOpacity
            style={[styles.filterChip, isDarkMode && styles.subtleDark, !isFavoritesMode && !isTrashMode && styles.filterChipActive]}
            onPress={() => handleModeChange('all')}
          >
            <Text style={[styles.filterChipText, isDarkMode && styles.secondaryTextDark, !isFavoritesMode && !isTrashMode && styles.filterChipTextActive]}>All</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterChip, isDarkMode && styles.subtleDark, isFavoritesMode && styles.filterChipActive]}
            onPress={() => handleModeChange('favorites')}
          >
            <Text style={[styles.filterChipText, isDarkMode && styles.secondaryTextDark, isFavoritesMode && styles.filterChipTextActive]}>Favorites</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterChip, isDarkMode && styles.subtleDark, isTrashMode && styles.filterChipActive]}
            onPress={() => handleModeChange('trash')}
          >
            <Text style={[styles.filterChipText, isDarkMode && styles.secondaryTextDark, isTrashMode && styles.filterChipTextActive]}>Trash</Text>
          </TouchableOpacity>

          <View style={[styles.viewToggle, isDarkMode && styles.surfaceDark, isDarkMode && styles.borderDark]}>
            <TouchableOpacity onPress={() => setViewMode('list')}>
              <MaterialIcons name="view-list" size={22} color={viewMode === 'list' ? '#3e577a' : '#9ca3af'} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setViewMode('grid')}>
              <MaterialIcons name="grid-view" size={22} color={viewMode === 'grid' ? '#3e577a' : '#9ca3af'} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.summaryRow}>
          <Text style={[styles.summaryTitle, isDarkMode && styles.secondaryTextDark]}>{selectionMode ? 'Toplu islem modu' : 'All Items'}</Text>
          <View style={styles.summaryBadge}>
            <Text style={styles.summaryBadgeText}>{selectionMode ? `${selectedFileIds.length} secildi` : `${filteredData.length} items`}</Text>
          </View>
        </View>

        {selectionMode ? (
          <View style={[styles.selectionHintCard, isDarkMode && styles.surfaceDark, isDarkMode && styles.borderDark]}>
            <MaterialIcons name="touch-app" size={18} color="#2563eb" />
            <Text style={[styles.selectionHintText, isDarkMode && styles.secondaryTextDark]}>
              Dosyalari secmek icin dokun. Bir klasore dokunursan secilen dosyalar o klasore tasinir.
            </Text>
          </View>
        ) : null}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.breadcrumbs}>
          {folderHistory.map((folder, index) => (
            <TouchableOpacity key={`${folder.id ?? 'root'}-${index}`} onPress={() => handleBreadcrumbPress(index)} style={[styles.breadcrumbItem, isDarkMode && styles.surfaceDark, isDarkMode && styles.borderDark, index === folderHistory.length - 1 && styles.breadcrumbItemActive]}>
              {index === 0 ? <MaterialIcons name="home" size={16} color={index === folderHistory.length - 1 ? '#ffffff' : '#6b7280'} /> : null}
              <Text style={[styles.breadcrumbText, isDarkMode && styles.secondaryTextDark, index === folderHistory.length - 1 && styles.breadcrumbTextActive]}>
                {folder.name}
              </Text>
              {index < folderHistory.length - 1 ? <MaterialIcons name="chevron-right" size={16} color="#9ca3af" /> : null}
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {loading && <ActivityIndicator style={{ marginTop: 16 }} size="large" color="#3e577a" />}

      <FlatList
        key={viewMode}
        data={filteredData}
        renderItem={renderItem}
        keyExtractor={(item) => item.id.toString() + (item.filename ? '_file' : '_folder')}
        numColumns={viewMode === 'grid' ? 2 : 1}
        style={isDarkMode ? styles.listDark : undefined}
        scrollEnabled={!draggingFile}
        scrollEventThrottle={32}
        onScroll={() => {
          if (draggingFile) {
            refreshFolderDropTargets();
          }
        }}
        contentContainerStyle={{ padding: 16, paddingBottom: Math.max(insets.bottom + 112, 128) }}
        ListEmptyComponent={
            !loading ? (
                <View style={styles.emptyState}>
                    <MaterialIcons name="folder-open" size={64} color="#ccc" />
                    <Text style={[styles.emptyText, isDarkMode && styles.secondaryTextDark]}>{searchQuery ? 'No results found' : 'Empty Folder'}</Text>
                </View>
            ) : null
        }
      />

      {draggingFile ? (
        <View pointerEvents="none" style={styles.dragLayer}>
          <View
            style={[
              styles.dragGhost,
              isDarkMode && styles.surfaceDark,
              {
                left: dragPosition.x - 110,
                top: dragPosition.y - 34,
                borderColor: hoveredFolderId ? '#2563eb' : '#cbd5e1',
              },
            ]}
          >
            <MaterialIcons name="drive-file-move" size={18} color={hoveredFolderId ? '#2563eb' : '#64748b'} />
            <Text style={[styles.dragGhostText, isDarkMode && styles.primaryTextDark]} numberOfLines={1}>
              {getDisplayName(draggingFile)}
            </Text>
          </View>
        </View>
      ) : null}

      {/* FAB */}
      {!isTrashMode && (
        <TouchableOpacity 
            style={styles.fab}
            onPress={handleUploadPress}
        >
            <MaterialIcons name="add" size={32} color="white" />
        </TouchableOpacity>
      )}

      {/* Uploading Modal */}
      <Modal
        visible={uploading}
        transparent
        animationType="slide"
      >
        <View style={styles.sheetOverlay}>
          <View style={[styles.uploadSheet, isDarkMode && styles.sheetDark]}>
            <View style={styles.sheetHandle} />
            <Text style={[styles.uploadSheetTitle, isDarkMode && styles.primaryTextDark]}>Upload Files</Text>
            <Text style={[styles.uploadSheetSubtitle, isDarkMode && styles.secondaryTextDark]}>
              {batchUploadTotal > 1
                ? `${batchUploadIndex}/${batchUploadTotal} dosya yukleniyor`
                : '1 file uploading now'}
            </Text>
            <View style={[styles.uploadDropZone, isDarkMode && styles.uploadDropZoneDark]}>
              <View style={[styles.uploadDropIcon, isDarkMode && styles.surfaceDark]}>
                <MaterialIcons name="cloud-upload" size={30} color="#3e577a" />
              </View>
              <Text style={[styles.uploadDropTitle, isDarkMode && styles.primaryTextDark]}>Tap to browse</Text>
              <Text style={[styles.uploadDropSubtitle, isDarkMode && styles.secondaryTextDark]}>Upload devam ederken dosyalar guvenli olarak hazirlaniyor</Text>
            </View>
            <Text style={[styles.uploadSectionTitle, isDarkMode && styles.primaryTextDark]}>Active Uploads</Text>
            <View style={[styles.activeUploadCard, isDarkMode && styles.surfaceDark, isDarkMode && styles.borderDark]}>
              <View style={[styles.activeUploadProgressEdge, { width: `${Math.max(uploadProgress * 100, 8)}%` }]} />
              <View style={styles.activeUploadIcon}>
                <MaterialIcons name={getFileIconMeta(activeUploadName.toLowerCase().endsWith('.zip') ? 'application/zip' : activeUploadName.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream').name} size={22} color="#3e577a" />
              </View>
              <View style={styles.activeUploadContent}>
                <View style={styles.activeUploadRow}>
                  <Text style={[styles.activeUploadName, isDarkMode && styles.primaryTextDark]} numberOfLines={1}>{activeUploadName}</Text>
                  <ActivityIndicator size="small" color="#3e577a" />
                </View>
                <View style={styles.activeUploadMetaRow}>
                  <Text style={styles.activeUploadStatus}>
                    {batchUploadTotal > 1
                      ? `Toplam ${batchUploadIndex}/${batchUploadTotal} • ${(uploadProgress * 100).toFixed(0)}%`
                      : `Uploading... ${(uploadProgress * 100).toFixed(0)}%`}
                  </Text>
                  <Text style={[styles.activeUploadSize, isDarkMode && styles.secondaryTextDark]}>{uploadStatus}</Text>
                </View>
                <View style={[styles.uploadProgressTrack, isDarkMode && styles.subtleDark]}>
                  <View style={[styles.uploadProgressFill, { width: `${Math.max(uploadProgress * 100, 8)}%` }]} />
                </View>
              </View>
            </View>
            <TouchableOpacity style={[styles.secondarySheetButton, isDarkMode && styles.surfaceDark, isDarkMode && styles.borderDark]} onPress={() => setUploading(false)}>
              <Text style={[styles.secondarySheetButtonText, isDarkMode && styles.primaryTextDark]}>Minimize to Tray</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showUploadPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowUploadPicker(false)}
      >
        <View style={styles.sheetOverlay}>
          <View style={[styles.uploadSheet, isDarkMode && styles.sheetDark]}>
            <View style={styles.sheetHandle} />
            <Text style={[styles.uploadSheetTitle, isDarkMode && styles.primaryTextDark]}>Upload Files</Text>
            <Text style={[styles.uploadSheetSubtitle, isDarkMode && styles.secondaryTextDark]}>2 sources available</Text>

            <TouchableOpacity
              style={[styles.uploadDropZone, isDarkMode && styles.uploadDropZoneDark]}
              onPress={() => {
                setShowUploadPicker(false);
                pickDocument();
              }}
            >
              <View style={[styles.uploadDropIcon, isDarkMode && styles.surfaceDark]}>
                <MaterialIcons name="cloud-upload" size={30} color="#3e577a" />
              </View>
              <Text style={[styles.uploadDropTitle, isDarkMode && styles.primaryTextDark]}>Tap to browse</Text>
              <Text style={[styles.uploadDropSubtitle, isDarkMode && styles.secondaryTextDark]}>Dosya sec veya galeriden ekle</Text>
            </TouchableOpacity>

            <Text style={[styles.uploadSectionTitle, isDarkMode && styles.primaryTextDark]}>Choose Source</Text>

            <TouchableOpacity
              style={[styles.sourceOption, isDarkMode && styles.surfaceDark, isDarkMode && styles.borderDark]}
              onPress={() => {
                setShowUploadPicker(false);
                pickImage();
              }}
            >
              <View style={[styles.sourceOptionIcon, { backgroundColor: '#dbeafe' }]}>
                <MaterialIcons name="photo-library" size={22} color="#2563eb" />
              </View>
              <View style={styles.sourceOptionContent}>
                <Text style={[styles.sourceOptionTitle, isDarkMode && styles.primaryTextDark]}>Galeri</Text>
                <Text style={[styles.sourceOptionText, isDarkMode && styles.secondaryTextDark]}>Fotoğraf ve videolar arasindan sec</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.sourceOption, isDarkMode && styles.surfaceDark, isDarkMode && styles.borderDark]}
              onPress={() => {
                setShowUploadPicker(false);
                pickDocument();
              }}
            >
              <View style={[styles.sourceOptionIcon, { backgroundColor: '#ede9fe' }]}>
                <MaterialIcons name="description" size={22} color="#7c3aed" />
              </View>
              <View style={styles.sourceOptionContent}>
                <Text style={[styles.sourceOptionTitle, isDarkMode && styles.primaryTextDark]}>Belge</Text>
                <Text style={[styles.sourceOptionText, isDarkMode && styles.secondaryTextDark]}>PDF, ZIP, DOCX ve diger dosyalari sec</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.secondarySheetButton, isDarkMode && styles.subtleDark]} onPress={() => setShowUploadPicker(false)}>
              <Text style={[styles.secondarySheetButtonText, isDarkMode && styles.primaryTextDark]}>Iptal</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={statusMessage.visible}
        transparent
        animationType="fade"
        onRequestClose={() => setStatusMessage((current) => ({ ...current, visible: false }))}
      >
        <View style={styles.statusOverlay}>
          <View style={[styles.statusCard, isDarkMode && styles.surfaceDark]}>
            <View
              style={[
                styles.statusIconWrap,
                statusMessage.tone === 'success'
                  ? styles.statusIconSuccess
                  : statusMessage.tone === 'error'
                    ? styles.statusIconError
                    : styles.statusIconInfo,
              ]}
            >
              <MaterialIcons
                name={
                  statusMessage.tone === 'success'
                    ? 'check-circle'
                    : statusMessage.tone === 'error'
                      ? 'error-outline'
                      : 'info-outline'
                }
                size={24}
                color={statusMessage.tone === 'success' ? '#15803d' : statusMessage.tone === 'error' ? '#b91c1c' : '#1d4ed8'}
              />
            </View>
            <Text style={[styles.statusTitle, isDarkMode && styles.primaryTextDark]}>{statusMessage.title}</Text>
            <Text style={[styles.statusText, isDarkMode && styles.secondaryTextDark]}>{statusMessage.message}</Text>
            <TouchableOpacity
              style={styles.statusButton}
              onPress={() => setStatusMessage((current) => ({ ...current, visible: false }))}
            >
              <Text style={styles.statusButtonText}>Tamam</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Create Folder Modal */}
      <Modal
        visible={createFolderModal}
        transparent
        animationType="fade"
        onRequestClose={closeCreateFolderModal}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, isDarkMode && styles.surfaceDark]}>
            <Text style={[styles.modalTitle, isDarkMode && styles.primaryTextDark]}>Yeni klasor</Text>
            <TextInput
              style={[styles.input, isDarkMode && styles.subtleDark, isDarkMode && styles.borderDark, isDarkMode && styles.primaryTextDark]}
              placeholder="Klasor adi"
              placeholderTextColor={isDarkMode ? '#94a3b8' : '#9ca3af'}
              value={newFolderName}
              onChangeText={setNewFolderName}
              autoFocus
            />
            <Text style={[styles.folderFieldLabel, isDarkMode && styles.secondaryTextDark]}>Renk</Text>
            <View style={styles.folderOptionRow}>
              {FOLDER_COLOR_OPTIONS.map((color) => (
                <TouchableOpacity
                  key={color}
                  onPress={() => setNewFolderColor(color)}
                  style={[
                    styles.folderColorOption,
                    { backgroundColor: color },
                    newFolderColor === color && styles.folderOptionSelected,
                  ]}
                >
                  {newFolderColor === color ? <MaterialIcons name="check" size={16} color="#ffffff" /> : null}
                </TouchableOpacity>
              ))}
            </View>
            <Text style={[styles.folderFieldLabel, isDarkMode && styles.secondaryTextDark]}>Ikon</Text>
            <View style={styles.folderIconGrid}>
              {FOLDER_ICON_OPTIONS.map((iconName) => (
                <TouchableOpacity
                  key={iconName}
                  onPress={() => setNewFolderIcon(iconName)}
                  style={[
                    styles.folderIconOption,
                    isDarkMode && styles.subtleDark,
                    isDarkMode && styles.borderDark,
                    newFolderIcon === iconName && styles.folderIconOptionSelected,
                  ]}
                >
                  <MaterialIcons name={iconName as any} size={22} color={newFolderColor} />
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={closeCreateFolderModal}>
                <Text style={[styles.modalCancel, isDarkMode && styles.secondaryTextDark]}>Iptal</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleCreateFolder}>
                <Text style={styles.modalCreate}>Olustur</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showMoveModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowMoveModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, isDarkMode && styles.surfaceDark]}>
            <Text style={[styles.modalTitle, isDarkMode && styles.primaryTextDark]}>Klasore tasi</Text>
            <Text style={[styles.moveModalText, isDarkMode && styles.secondaryTextDark]}>
              {selectedFileIds.length} secili dosya icin hedef klasoru sec.
            </Text>
            <ScrollView style={styles.moveFolderList} contentContainerStyle={styles.moveFolderListContent}>
              {moveFolderOptions.map((folder) => (
                <TouchableOpacity
                  key={`move-folder-${folder.id ?? 'root'}`}
                  style={[styles.moveFolderRow, isDarkMode && styles.subtleDark, isDarkMode && styles.borderDark]}
                  onPress={() => void moveSelectedFilesToFolder(folder.id, folder.name)}
                  disabled={moveLoading}
                >
                  <MaterialIcons name={folder.id ? 'folder' : 'home'} size={18} color="#3e577a" />
                  <Text style={[styles.moveFolderName, isDarkMode && styles.primaryTextDark, { marginLeft: 12 + folder.depth * 14 }]}>
                    {folder.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setShowMoveModal(false)} disabled={moveLoading}>
                <Text style={[styles.modalCancel, isDarkMode && styles.secondaryTextDark]}>Iptal</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Preview Modal */}
      <Modal
        visible={previewFile !== null}
        transparent={false}
        animationType="slide"
        onRequestClose={closePreview}
      >
        <SafeAreaView style={[styles.previewScreen, isDarkMode && styles.safeAreaDark]} edges={['top', 'bottom', 'left', 'right']}>
          <Animated.View
            style={[styles.previewGestureScreen, { transform: [{ translateX: previewTranslateX }] }]}
            {...previewPanResponder.panHandlers}
          >
          <View style={[styles.previewHeader, isDarkMode && styles.previewHeaderDark, { paddingTop: Math.max(insets.top, 8), paddingBottom: Math.max(insets.bottom > 0 ? 10 : 12, 10) }]}>
            <TouchableOpacity onPress={closePreview} style={styles.previewHeaderButton}>
              <MaterialIcons name="arrow-back-ios-new" size={22} color={isDarkMode ? '#f8fafc' : '#111827'} />
            </TouchableOpacity>
            <Text style={[styles.previewTitle, isDarkMode && styles.primaryTextDark]} numberOfLines={1}>
              {getDisplayName(previewFile)}
            </Text>
            <View style={styles.previewHeaderActions}>
              <TouchableOpacity onPress={() => openRenameEditor(previewFile)} style={styles.previewHeaderButton}>
                <MaterialIcons name="edit" size={20} color={isDarkMode ? '#f8fafc' : '#111827'} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => openShareSheet(previewFile)} style={styles.previewHeaderButton}>
                <MaterialIcons name="share" size={22} color={isDarkMode ? '#f8fafc' : '#111827'} />
              </TouchableOpacity>
            </View>
          </View>

          {renameEditorVisible ? (
            <View style={[styles.previewInlineRename, isDarkMode && styles.surfaceDark, isDarkMode && styles.borderDark]}>
              <Text style={[styles.metaTitle, isDarkMode && styles.secondaryTextDark]}>Rename File</Text>
              <TextInput
                ref={renameInputRef}
                style={[styles.input, styles.renameInlineInput, isDarkMode && styles.subtleDark, isDarkMode && styles.borderDark, isDarkMode && styles.primaryTextDark]}
                placeholder="File name"
                placeholderTextColor={isDarkMode ? '#94a3b8' : '#9ca3af'}
                value={renameValue}
                onChangeText={setRenameValue}
                returnKeyType="done"
                onSubmitEditing={handleRenameFile}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <View style={styles.modalActions}>
                <TouchableOpacity
                  onPress={() => {
                    setRenameEditorVisible(false);
                    setRenameValue(getDisplayName(previewFile));
                  }}
                  disabled={renameSaving}
                >
                  <Text style={[styles.modalCancel, isDarkMode && styles.secondaryTextDark]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleRenameFile} disabled={renameSaving}>
                  <Text style={[styles.modalCreate, renameSaving && styles.modalActionDisabled]}>
                    {renameSaving ? 'Saving...' : 'Save'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          <ScrollView contentContainerStyle={styles.previewBody}>
            <View style={[styles.previewCard, isDarkMode && styles.surfaceDark]}>
              {isPreviewImage && !previewBlocked ? (
                <Image
                  source={{ uri: `${Config.API_URL}/preview/${previewFile.file_id}` }}
                  style={styles.previewHeroImage}
                  resizeMode="cover"
                />
              ) : isPreviewVideo && !previewBlocked ? (
                <VideoView
                  player={previewVideoPlayer}
                  style={styles.previewHeroVideo}
                  nativeControls
                  contentFit="contain"
                  fullscreenOptions={{ enable: true }}
                  allowsPictureInPicture
                />
              ) : (
                <View style={[styles.previewFallback, isDarkMode && styles.surfaceDark]}>
                  <MaterialIcons name={previewBlocked ? 'warning-amber' : 'insert-drive-file'} size={90} color="#6b7280" />
                  <Text style={[styles.previewFallbackText, isDarkMode && styles.secondaryTextDark]}>
                    {previewBlocked ? 'Dosya boyutu yuksek, on izleme kullanilamiyor' : 'Preview'}
                  </Text>
                </View>
              )}
              <View style={styles.previewOverlay} pointerEvents="none">
                <View style={styles.previewBadge}>
                  <MaterialIcons name="visibility" size={16} color="white" />
                  <Text style={styles.previewBadgeText}>{previewBlocked ? 'Preview Unavailable' : isPreviewVideo ? 'Video Preview' : 'Preview'}</Text>
                </View>
              </View>
            </View>

            <View style={styles.previewInfoBlock}>
              <Text style={[styles.previewFileName, isDarkMode && styles.primaryTextDark]}>{getDisplayName(previewFile)}</Text>
              <Text style={[styles.previewPathText, isDarkMode && styles.secondaryTextDark]}>
                {isFavoritesMode ? 'Favorites' : isTrashMode ? 'Trash' : folderHistory.map((folder) => folder.name).join(' / ')}
              </Text>
            </View>

            <View style={[styles.metaCard, isDarkMode && styles.surfaceDark, isDarkMode && styles.borderDark]}>
              <Text style={[styles.metaTitle, isDarkMode && styles.secondaryTextDark]}>File Details</Text>
              <View style={styles.metaGrid}>
                <View style={styles.metaItem}>
                  <Text style={styles.metaLabel}>Size</Text>
                  <Text style={[styles.metaValue, isDarkMode && styles.primaryTextDark]}>{formatBytes(previewFile?.file_size || 0)}</Text>
                </View>
                <View style={styles.metaItem}>
                  <Text style={styles.metaLabel}>Type</Text>
                  <Text style={[styles.metaValue, isDarkMode && styles.primaryTextDark]}>{previewFile?.mime_type || 'Unknown'}</Text>
                </View>
                <View style={styles.metaItem}>
                  <Text style={styles.metaLabel}>Created</Text>
                  <Text style={[styles.metaValue, isDarkMode && styles.primaryTextDark]}>{previewFile ? new Date(previewFile.upload_date).toLocaleDateString() : '-'}</Text>
                </View>
                <View style={styles.metaItem}>
                  <Text style={styles.metaLabel}>Favorites</Text>
                  <Text style={[styles.metaValue, isDarkMode && styles.primaryTextDark]}>{previewFile?.is_favorite ? 'Starred' : 'Not starred'}</Text>
                </View>
              </View>
            </View>
          </ScrollView>

          <View style={[styles.previewActionBar, isDarkMode && styles.previewHeaderDark, { paddingBottom: Math.max(insets.bottom, 14) }]}>
            <TouchableOpacity style={[styles.previewSecondaryButton, isDarkMode && styles.surfaceDark, isDarkMode && styles.borderDark]} onPress={() => downloadFile(previewFile)} disabled={isDownloading}>
              {isDownloading ? (
                <>
                  <ActivityIndicator color={isDarkMode ? '#f8fafc' : '#111827'} style={{ marginRight: 8 }} />
                  <Text style={[styles.previewSecondaryButtonText, isDarkMode && styles.primaryTextDark]}>{(downloadProgress * 100).toFixed(0)}%</Text>
                </>
              ) : (
                <>
                  <MaterialIcons name="download" size={20} color={isDarkMode ? '#f8fafc' : '#111827'} />
                  <Text style={[styles.previewSecondaryButtonText, isDarkMode && styles.primaryTextDark]}>Download</Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.previewPrimaryButton} onPress={() => openShareSheet(previewFile)}>
              <MaterialIcons name="share" size={20} color="white" />
              <Text style={styles.previewPrimaryButtonText}>Share</Text>
            </TouchableOpacity>
          </View>
          </Animated.View>
        </SafeAreaView>
      </Modal>

      <Modal
        visible={shareFile !== null}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setShareFile(null);
          setShareLink('');
        }}
      >
        <View style={styles.sheetOverlay}>
          <View style={[styles.shareModal, isDarkMode && styles.sheetDark]}>
            <View style={styles.sheetHandle} />
            <View style={styles.shareHeader}>
              <View style={styles.shareHeaderContent}>
                <Text style={[styles.shareModalTitle, isDarkMode && styles.primaryTextDark]}>Share File</Text>
                <Text style={[styles.shareModalSubtitle, isDarkMode && styles.secondaryTextDark]} numberOfLines={1}>
                  {getDisplayName(shareFile)}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  setShareFile(null);
                  setShareLink('');
                }}
                style={[styles.shareCloseButton, isDarkMode && styles.surfaceDark, isDarkMode && styles.borderDark]}
              >
                <MaterialIcons name="close" size={20} color={isDarkMode ? '#cbd5e1' : '#6b7280'} />
              </TouchableOpacity>
            </View>

            <View style={[styles.sharePeopleCard, isDarkMode && styles.surfaceDark, isDarkMode && styles.borderDark]}>
              <Text style={[styles.shareSectionTitle, isDarkMode && styles.primaryTextDark]}>General access</Text>
              <View style={styles.shareAccessRow}>
                <View style={[styles.shareAccessIcon, isDarkMode && styles.subtleDark]}>
                  <MaterialIcons name="lock" size={18} color={isDarkMode ? '#cbd5e1' : '#6b7280'} />
                </View>
                <View style={styles.shareAccessTextWrap}>
                  <Text style={[styles.shareAccessTitle, isDarkMode && styles.primaryTextDark]}>Secure download page</Text>
                  <Text style={[styles.shareAccessSubtitle, isDarkMode && styles.secondaryTextDark]}>Link opens a branded download screen, not the direct Telegram URL.</Text>
                </View>
              </View>
            </View>

            <View style={[styles.shareLinkCard, isDarkMode && styles.surfaceDark, isDarkMode && styles.borderDark]}>
              <View style={styles.shareLinkIcon}>
                <MaterialIcons name="link" size={20} color="#3e577a" />
              </View>
              <View style={styles.shareLinkContent}>
                <Text style={[styles.shareLinkLabel, isDarkMode && styles.primaryTextDark]}>Download page</Text>
                <Text
                  style={[styles.shareLinkValue, isDarkMode && styles.secondaryTextDark]}
                  numberOfLines={2}
                  selectable
                >
                  {shareLoading ? 'Secure link is being prepared...' : shareLink || 'Secure link will appear here'}
                </Text>
              </View>
            </View>

            <View style={[styles.shareMessageCard, isDarkMode && styles.surfaceDark, isDarkMode && styles.borderDark]}>
              <View style={styles.shareMessageHeader}>
                <MaterialIcons name="send" size={18} color="#3e577a" />
                <Text style={[styles.shareSectionTitle, isDarkMode && styles.primaryTextDark]}>Arkadasina gonder</Text>
              </View>
              <Text style={[styles.shareMessageText, isDarkMode && styles.secondaryTextDark]} selectable>
                {shareLoading || !shareLink ? 'Paylasilabilir mesaj link hazir olunca burada gorunur.' : buildShareMessage(shareFile, shareLink)}
              </Text>
            </View>

            <View style={[styles.shareSettingRow, isDarkMode && styles.surfaceDark, isDarkMode && styles.borderDark]}>
              <View>
                <Text style={[styles.shareSettingTitle, isDarkMode && styles.primaryTextDark]}>Link expiration</Text>
                <Text style={[styles.shareSettingSubtitle, isDarkMode && styles.secondaryTextDark]}>Hazirlik asamasinda, simdilik baglanti aktif kalir.</Text>
              </View>
              <Switch
                value={shareExpiryEnabled}
                onValueChange={setShareExpiryEnabled}
                trackColor={{ false: '#d1d5db', true: '#93c5fd' }}
                thumbColor={shareExpiryEnabled ? '#1d4ed8' : '#ffffff'}
              />
            </View>

            <TouchableOpacity
              style={[styles.sharePrimaryButton, shareLoading && styles.sharePrimaryButtonDisabled]}
              onPress={() => shareLink && Linking.openURL(shareLink)}
              disabled={!shareLink || shareLoading}
            >
              <MaterialIcons name="download" size={18} color="#ffffff" />
              <Text style={styles.sharePrimaryButtonText}>Open Download Page</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.shareSecondaryButton, isDarkMode && styles.surfaceDark, isDarkMode && styles.borderDark]}
              onPress={() => shareLink && Share.share({ message: buildShareMessage(shareFile, shareLink), url: shareLink })}
              disabled={!shareLink || shareLoading}
            >
              <MaterialIcons name="ios-share" size={18} color={isDarkMode ? '#f8fafc' : '#111827'} />
              <Text style={[styles.shareSecondaryButtonText, isDarkMode && styles.primaryTextDark]}>Share Link</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  safeAreaDark: {
    backgroundColor: '#020617',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#f9fafb',
    borderBottomWidth: 1,
    borderBottomColor: '#eef2f7',
    zIndex: 10,
  },
  headerDark: {
    backgroundColor: '#020617',
    borderBottomColor: '#1e293b',
  },
  headerIconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#eef2f7',
    marginRight: 12,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    flex: 1,
    color: '#1f2937',
  },
  headerActions: {
    flexDirection: 'row',
    gap: 16,
  },
  toolbar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: '#f9fafb',
    gap: 12,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 48,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.03,
    shadowRadius: 10,
    elevation: 1,
  },
  searchInput: {
    flex: 1,
    marginLeft: 10,
    color: '#111827',
  },
  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: '#eef2f7',
  },
  filterChipActive: {
    backgroundColor: '#3e577a',
  },
  filterChipText: {
    color: '#4b5563',
    fontWeight: '600',
    fontSize: 12,
  },
  filterChipTextActive: {
    color: '#ffffff',
  },
  viewToggle: {
    marginLeft: 'auto',
    flexDirection: 'row',
    gap: 12,
    backgroundColor: 'white',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  summaryTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  summaryBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: '#dbeafe',
  },
  summaryBadgeText: {
    color: '#3e577a',
    fontSize: 12,
    fontWeight: '700',
  },
  breadcrumbs: {
    flexDirection: 'row',
    gap: 8,
    paddingRight: 16,
  },
  breadcrumbItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  breadcrumbItemActive: {
    backgroundColor: '#3e577a',
    borderColor: '#3e577a',
  },
  breadcrumbText: {
    color: '#6b7280',
    fontWeight: '500',
  },
  breadcrumbTextActive: {
    color: '#ffffff',
  },
  itemContainer: {
    backgroundColor: 'white',
    padding: 16,
    marginBottom: 8,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#eef2f7',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  itemContainerSelected: {
    borderColor: '#3e577a',
    backgroundColor: 'rgba(62, 87, 122, 0.08)',
  },
  folderDropTargetActive: {
    borderColor: '#2563eb',
    backgroundColor: 'rgba(37, 99, 235, 0.08)',
    shadowOpacity: 0.12,
  },
  gridItemContainer: {
    flex: 1,
    marginHorizontal: 4,
    alignItems: 'flex-start',
    flexDirection: 'column',
    minHeight: 180,
  },
  folderIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    marginRight: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  gridFolderIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 18,
    marginRight: 0,
    marginBottom: 16,
  },
  leadingIcon: {
    marginRight: 16,
  },
  folderLeadingIcon: {
    marginRight: 0,
  },
  gridLeadingIcon: {
    marginRight: 0,
    marginBottom: 16,
  },
  previewThumb: {
    width: 40,
    height: 40,
    borderRadius: 8,
    marginRight: 16,
    backgroundColor: '#eee',
  },
  gridPreviewThumb: {
    width: '100%',
    height: 96,
    marginRight: 0,
    marginBottom: 16,
  },
  fileTypeIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    marginRight: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridFileTypeIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 18,
    marginRight: 0,
    marginBottom: 16,
  },
  itemContent: {
    flex: 1,
  },
  gridItemContent: {
    width: '100%',
  },
  itemActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 8,
  },
  gridItemActions: {
    marginLeft: 0,
    marginTop: 12,
    alignSelf: 'stretch',
    justifyContent: 'space-between',
  },
  iconButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#eef2f7',
  },
  dragHandleButton: {
    borderStyle: 'dashed',
  },
  dragHandleActive: {
    borderColor: '#2563eb',
    backgroundColor: '#dbeafe',
  },
  selectionBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    marginRight: 8,
  },
  selectionBadgeActive: {
    backgroundColor: '#3e577a',
    borderColor: '#3e577a',
  },
  itemName: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1f2937',
  },
  itemMeta: {
    color: '#6b7280',
    fontSize: 12,
  },
  emptyState: {
    alignItems: 'center',
    marginTop: 80,
  },
  emptyText: {
    color: '#9ca3af',
    marginTop: 16,
    fontSize: 18,
  },
  listDark: {
    backgroundColor: '#020617',
  },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    backgroundColor: '#3e577a',
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 8,
  },
  dragLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 40,
  },
  dragGhost: {
    position: 'absolute',
    width: 220,
    minHeight: 52,
    borderRadius: 18,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.16,
    shadowRadius: 16,
    elevation: 10,
  },
  dragGhostText: {
    flex: 1,
    color: '#111827',
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  sheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
    justifyContent: 'flex-end',
  },
  uploadSheet: {
    backgroundColor: '#f9fafb',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 36,
  },
  shareModal: {
    backgroundColor: '#f9fafb',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 32,
  },
  sheetDark: {
    backgroundColor: '#020617',
  },
  sheetHandle: {
    width: 48,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#d1d5db',
    alignSelf: 'center',
    marginBottom: 18,
  },
  uploadSheetTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111827',
  },
  uploadSheetSubtitle: {
    marginTop: 4,
    color: '#6b7280',
    marginBottom: 20,
  },
  uploadSectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 14,
  },
  shareHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  shareHeaderContent: {
    flex: 1,
    marginRight: 12,
  },
  shareModalTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
  },
  shareModalSubtitle: {
    marginTop: 4,
    color: '#6b7280',
  },
  shareCloseButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sharePeopleCard: {
    borderRadius: 22,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    padding: 16,
    marginBottom: 14,
  },
  shareSectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 12,
  },
  shareAccessRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  shareAccessIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  shareAccessTextWrap: {
    flex: 1,
  },
  shareAccessTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
  },
  shareAccessSubtitle: {
    marginTop: 4,
    color: '#6b7280',
    fontSize: 12,
    lineHeight: 18,
  },
  shareLinkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    padding: 16,
    marginBottom: 14,
  },
  shareLinkIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  shareLinkContent: {
    flex: 1,
  },
  shareLinkLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  shareLinkValue: {
    color: '#6b7280',
    fontSize: 12,
    lineHeight: 18,
  },
  shareMessageCard: {
    borderRadius: 20,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    padding: 16,
    marginBottom: 14,
  },
  shareMessageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  shareMessageText: {
    fontSize: 13,
    lineHeight: 20,
    color: '#6b7280',
  },
  shareSettingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 18,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    padding: 16,
    marginBottom: 18,
  },
  shareSettingTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
  },
  shareSettingSubtitle: {
    marginTop: 4,
    fontSize: 12,
    color: '#6b7280',
  },
  sharePrimaryButton: {
    height: 50,
    borderRadius: 16,
    backgroundColor: '#3e577a',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  sharePrimaryButtonDisabled: {
    opacity: 0.55,
  },
  sharePrimaryButtonText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  shareSecondaryButton: {
    height: 50,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  shareSecondaryButtonText: {
    color: '#111827',
    fontWeight: '700',
  },
  selectionHintCard: {
    marginTop: 12,
    marginBottom: 4,
    borderRadius: 18,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dbeafe',
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  selectionHintText: {
    flex: 1,
    color: '#475569',
    fontSize: 12,
    lineHeight: 18,
  },
  uploadDropZone: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: 'rgba(62, 87, 122, 0.25)',
    borderRadius: 22,
    backgroundColor: 'rgba(62, 87, 122, 0.05)',
    alignItems: 'center',
    paddingVertical: 28,
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  uploadDropZoneDark: {
    backgroundColor: 'rgba(30, 41, 59, 0.6)',
    borderColor: '#334155',
  },
  uploadDropIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  uploadDropTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  uploadDropSubtitle: {
    marginTop: 4,
    fontSize: 12,
    color: '#6b7280',
  },
  activeUploadCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: '#eef2f7',
    overflow: 'hidden',
    position: 'relative',
    marginBottom: 14,
  },
  activeUploadProgressEdge: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    height: 3,
    backgroundColor: '#3e577a',
  },
  activeUploadIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeUploadContent: {
    flex: 1,
  },
  activeUploadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  activeUploadName: {
    flex: 1,
    color: '#111827',
    fontWeight: '600',
    marginRight: 12,
  },
  activeUploadStatus: {
    color: '#3e577a',
    fontSize: 12,
    fontWeight: '600',
  },
  activeUploadMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 6,
    marginBottom: 8,
  },
  activeUploadSize: {
    fontSize: 11,
    color: '#6b7280',
  },
  uploadProgressTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: '#e5e7eb',
    overflow: 'hidden',
  },
  uploadProgressFill: {
    width: '45%',
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#3e577a',
  },
  sourceOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 18,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#eef2f7',
    marginBottom: 12,
  },
  sourceOptionIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  sourceOptionContent: {
    flex: 1,
  },
  sourceOptionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  sourceOptionText: {
    marginTop: 4,
    fontSize: 12,
    color: '#6b7280',
  },
  secondarySheetButton: {
    marginTop: 8,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondarySheetButtonText: {
    color: '#111827',
    fontWeight: '700',
  },
  modalContent: {
    backgroundColor: 'white',
    width: '100%',
    maxWidth: 320,
    borderRadius: 16,
    padding: 24,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 16,
    color: '#1f2937',
  },
  folderFieldLabel: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 14,
    marginBottom: 10,
  },
  folderOptionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  folderColorOption: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  folderOptionSelected: {
    borderColor: '#111827',
  },
  folderIconGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  folderIconOption: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  folderIconOptionSelected: {
    borderColor: '#2563eb',
    backgroundColor: '#eff6ff',
  },
  moveModalText: {
    color: '#6b7280',
    marginBottom: 14,
    lineHeight: 18,
  },
  moveFolderList: {
    maxHeight: 320,
    marginBottom: 8,
  },
  moveFolderListContent: {
    gap: 10,
  },
  moveFolderRow: {
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  moveFolderName: {
    flex: 1,
    color: '#111827',
    fontWeight: '600',
  },
  input: {
    backgroundColor: '#f3f4f6',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    marginBottom: 16,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 16,
  },
  modalCancel: {
    color: '#6b7280',
    fontWeight: 'bold',
    padding: 8,
  },
  modalCreate: {
    color: '#3e577a',
    fontWeight: 'bold',
    padding: 8,
  },
  modalActionDisabled: {
    opacity: 0.55,
  },
  statusOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  statusCard: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 24,
    backgroundColor: '#ffffff',
    padding: 24,
    alignItems: 'center',
  },
  statusIconWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  statusIconSuccess: {
    backgroundColor: '#dcfce7',
  },
  statusIconError: {
    backgroundColor: '#fee2e2',
  },
  statusIconInfo: {
    backgroundColor: '#dbeafe',
  },
  statusTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  statusText: {
    textAlign: 'center',
    color: '#6b7280',
    lineHeight: 20,
  },
  statusButton: {
    marginTop: 20,
    minWidth: 120,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#3e577a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusButtonText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  previewScreen: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  previewGestureScreen: {
    flex: 1,
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    backgroundColor: 'rgba(249,250,251,0.95)',
  },
  previewHeaderDark: {
    backgroundColor: 'rgba(2,6,23,0.96)',
    borderTopColor: '#1e293b',
    borderBottomColor: '#1e293b',
  },
  previewHeaderButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  previewTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginHorizontal: 8,
  },
  previewInlineRename: {
    marginHorizontal: 16,
    marginTop: 14,
    padding: 16,
    borderRadius: 18,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  renameInlineInput: {
    marginTop: 10,
    marginBottom: 0,
  },
  previewBody: {
    padding: 16,
    paddingBottom: 120,
    gap: 18,
  },
  previewCard: {
    width: '100%',
    aspectRatio: 4 / 5,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#ffffff',
    position: 'relative',
  },
  previewHeroImage: {
    width: '100%',
    height: '100%',
  },
  previewHeroVideo: {
    width: '100%',
    height: '100%',
    backgroundColor: '#000000',
  },
  previewFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  previewFallbackText: {
    marginTop: 12,
    fontSize: 14,
    fontWeight: '600',
    color: '#4b5563',
  },
  previewOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 16,
    backgroundColor: 'rgba(17,24,39,0.22)',
  },
  previewBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(17,24,39,0.45)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  previewBadgeText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 12,
  },
  previewInfoBlock: {
    gap: 6,
  },
  previewFileName: {
    fontSize: 26,
    fontWeight: '700',
    color: '#111827',
  },
  previewPathText: {
    color: '#6b7280',
    fontSize: 14,
  },
  metaCard: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#eef2f7',
    padding: 18,
  },
  metaTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 16,
  },
  metaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 18,
  },
  metaItem: {
    width: '50%',
    paddingRight: 12,
  },
  metaLabel: {
    fontSize: 12,
    color: '#9ca3af',
    marginBottom: 6,
  },
  metaValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  previewActionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: 'rgba(249,250,251,0.96)',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  previewSecondaryButton: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#d1d5db',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  previewSecondaryButtonText: {
    color: '#111827',
    fontWeight: '700',
  },
  previewPrimaryButton: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#3e577a',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  previewPrimaryButtonText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  primaryTextDark: {
    color: '#f8fafc',
  },
  secondaryTextDark: {
    color: '#94a3b8',
  },
  surfaceDark: {
    backgroundColor: '#0f172a',
  },
  subtleDark: {
    backgroundColor: '#111827',
  },
  borderDark: {
    borderColor: '#1e293b',
  },
});
