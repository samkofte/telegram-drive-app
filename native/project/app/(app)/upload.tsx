import { useCallback, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { DimensionValue } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useNavigation } from '@react-navigation/native';
import api from '@/services/api';
import { useUIStore } from '@/store/uiStore';

function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const value = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const size = bytes / 1024 ** value;
  return `${size.toFixed(size >= 10 || value === 0 ? 0 : 1)} ${units[value]}`;
}

function getFileIconMeta(name?: string, mimeType?: string) {
  const target = `${name || ''} ${mimeType || ''}`.toLowerCase();
  if (target.includes('pdf')) return { name: 'picture-as-pdf' as const, bg: '#fee2e2', color: '#dc2626' };
  if (target.includes('zip') || target.includes('rar')) return { name: 'folder-zip' as const, bg: '#fef3c7', color: '#d97706' };
  if (target.includes('image') || target.match(/\.(png|jpg|jpeg|gif|webp)$/)) return { name: 'image' as const, bg: '#dbeafe', color: '#2563eb' };
  if (target.includes('video') || target.match(/\.(mp4|mov|avi|mkv)$/)) return { name: 'movie' as const, bg: '#ffedd5', color: '#ea580c' };
  if (target.includes('sheet') || target.includes('excel') || target.includes('csv') || target.match(/\.(xls|xlsx|csv)$/)) return { name: 'table-view' as const, bg: '#dcfce7', color: '#16a34a' };
  return { name: 'description' as const, bg: '#dbeafe', color: '#2563eb' };
}

type UploadQueueItem = {
  id: string;
  uri: string;
  name: string;
  mimeType: string;
  sizeLabel: string;
  progress: number;
  status: 'queued' | 'uploading' | 'completed' | 'error';
  detail: string;
};

export default function UploadScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const isDarkMode = useUIStore((state) => state.isDarkMode);
  const insets = useSafeAreaInsets();
  const queueRef = useRef<UploadQueueItem[]>([]);
  const processingRef = useRef(false);
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([]);
  const [lastUpload, setLastUpload] = useState<{
    name: string;
    sizeLabel: string;
  } | null>(null);

  const processQueue = useCallback(async () => {
    if (processingRef.current || queueRef.current.length === 0) {
      return;
    }

    processingRef.current = true;
    const current = queueRef.current[0];

    const updateQueueItem = (next: Partial<UploadQueueItem>) => {
      setUploadQueue((items) =>
        items.map((item) => (item.id === current.id ? { ...item, ...next } : item))
      );
    };

    const formData = new FormData();
    formData.append('file', {
      uri: current.uri,
      name: current.name,
      type: current.mimeType || 'application/octet-stream',
    } as any);

    updateQueueItem({
      status: 'uploading',
      progress: 0.14,
      detail: 'Preparing upload...',
    });

    try {
      updateQueueItem({
        progress: 0.52,
        detail: 'Uploading to secure storage...',
      });

      await api.post('/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        transformRequest: (data) => data,
      });

      updateQueueItem({
        status: 'completed',
        progress: 1,
        detail: 'Completed',
      });

      setLastUpload({
        name: current.name,
        sizeLabel: current.sizeLabel,
      });
    } catch (error: any) {
      updateQueueItem({
        status: 'error',
        progress: 1,
        detail: error.response?.data?.error || 'Upload failed',
      });
    } finally {
      queueRef.current = queueRef.current.filter((item) => item.id !== current.id);
      processingRef.current = false;

      if (queueRef.current.length > 0) {
        processQueue();
      }
    }
  }, []);

  const enqueueUpload = useCallback(async (uri: string, name: string, mimeType: string, size?: number | null) => {
    const queueItem: UploadQueueItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      uri,
      name,
      mimeType: mimeType || 'application/octet-stream',
      sizeLabel: formatBytes(size || 0),
      progress: 0,
      status: 'queued',
      detail: 'Waiting in queue',
    };

    queueRef.current = [...queueRef.current, queueItem];
    setUploadQueue((items) => [queueItem, ...items]);

    if (!processingRef.current) {
      processQueue();
    }
  }, [processQueue]);

  const pickDocument = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;
      const asset = result.assets[0];
      await enqueueUpload(asset.uri, asset.name, asset.mimeType || 'application/octet-stream', asset.size);
    } catch {
      return;
    }
  }, [enqueueUpload]);

  const pickImage = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        quality: 1,
      });

      if (result.canceled) return;
      const asset = result.assets[0];
      const filename = asset.fileName || asset.uri.split('/').pop() || 'media';
      const mimeType =
        asset.mimeType ||
        (asset.type === 'video' ? 'video/mp4' : 'image/jpeg');

      await enqueueUpload(asset.uri, filename, mimeType, asset.fileSize);
    } catch {
      return;
    }
  }, [enqueueUpload]);

  const handleBrowse = useCallback(() => {
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
      return;
    }

    pickDocument();
  }, [pickDocument, pickImage]);

  const uploadingCount = useMemo(
    () => uploadQueue.filter((item) => item.status === 'uploading' || item.status === 'queued').length,
    [uploadQueue]
  );

  const handleBackPress = useCallback(() => {
    if (navigation.canGoBack()) {
      router.back();
      return;
    }

    router.replace('/(app)/dashboard');
  }, [navigation, router]);

  return (
    <SafeAreaView style={[styles.safeArea, isDarkMode && styles.safeAreaDark]} edges={['top', 'left', 'right']}>
      <ScrollView
        style={isDarkMode ? styles.containerDark : undefined}
        contentContainerStyle={[styles.contentContainer, { paddingBottom: Math.max(insets.bottom + 104, 120) }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View>
            <Text style={[styles.title, isDarkMode && styles.primaryTextDark]}>Upload Files</Text>
            <Text style={[styles.subtitle, isDarkMode && styles.secondaryTextDark]}>
              {uploadingCount > 0 ? `${uploadingCount} file queued or uploading` : lastUpload ? 'Recent upload available' : 'Add files to your secure drive'}
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.headerButton, isDarkMode && styles.surfaceDark, isDarkMode && styles.borderDark]}
            onPress={handleBackPress}
          >
            <MaterialIcons name="arrow-back" size={20} color={isDarkMode ? '#f8fafc' : '#111827'} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.dropZone, isDarkMode && styles.dropZoneDark]}
          onPress={handleBrowse}
          activeOpacity={0.9}
        >
          <View style={[styles.dropZoneIconWrap, isDarkMode && styles.surfaceDark]}>
            <MaterialIcons name="cloud-upload" size={30} color="#3e577a" />
          </View>
          <Text style={[styles.dropZoneTitle, isDarkMode && styles.primaryTextDark]}>Tap to browse</Text>
          <Text style={[styles.dropZoneText, isDarkMode && styles.secondaryTextDark]}>
            or choose a source below
          </Text>
        </TouchableOpacity>

        <Text style={[styles.sectionTitle, isDarkMode && styles.primaryTextDark]}>Choose Source</Text>

        <TouchableOpacity
          style={[styles.sourceCard, isDarkMode && styles.surfaceDark, isDarkMode && styles.borderDark]}
          onPress={pickImage}
        >
          <View style={[styles.sourceIcon, { backgroundColor: '#ede9fe' }]}>
            <MaterialIcons name="photo-library" size={22} color="#7c3aed" />
          </View>
          <View style={styles.sourceContent}>
            <Text style={[styles.sourceTitle, isDarkMode && styles.primaryTextDark]}>Photo / Video Library</Text>
            <Text style={[styles.sourceText, isDarkMode && styles.secondaryTextDark]}>Images and videos from your gallery</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.sourceCard, isDarkMode && styles.surfaceDark, isDarkMode && styles.borderDark]}
          onPress={pickDocument}
        >
          <View style={[styles.sourceIcon, { backgroundColor: '#dbeafe' }]}>
            <MaterialIcons name="description" size={22} color="#2563eb" />
          </View>
          <View style={styles.sourceContent}>
            <Text style={[styles.sourceTitle, isDarkMode && styles.primaryTextDark]}>Document Browser</Text>
            <Text style={[styles.sourceText, isDarkMode && styles.secondaryTextDark]}>PDF, ZIP, DOCX and more</Text>
          </View>
        </TouchableOpacity>

        <Text style={[styles.sectionTitle, isDarkMode && styles.primaryTextDark]}>Active Uploads</Text>

        {uploadQueue.length > 0 ? (
          uploadQueue.map((item) => {
            const iconMeta = getFileIconMeta(item.name, item.mimeType);
            const isActive = item.status === 'uploading';
            const isDone = item.status === 'completed';
            const isError = item.status === 'error';
            const progressWidth: DimensionValue =
              item.status === 'queued' ? '0%' : (`${Math.max(item.progress * 100, 8)}%` as `${number}%`);

            return (
              <View key={item.id} style={[styles.uploadCard, isDarkMode && styles.surfaceDark, isDarkMode && styles.borderDark]}>
                <View style={[styles.uploadEdge, { width: progressWidth, backgroundColor: isError ? '#ef4444' : isDone ? '#10b981' : '#3e577a' }]} />
                <View style={[styles.uploadIcon, { backgroundColor: isDone ? '#dcfce7' : isError ? '#fee2e2' : iconMeta.bg }]}>
                  {isDone ? (
                    <MaterialIcons name="check-circle" size={22} color="#10b981" />
                  ) : isError ? (
                    <MaterialIcons name="error-outline" size={22} color="#ef4444" />
                  ) : (
                    <MaterialIcons name={iconMeta.name} size={22} color={iconMeta.color} />
                  )}
                </View>
                <View style={styles.uploadBody}>
                  <View style={styles.uploadTopRow}>
                    <Text style={[styles.uploadName, isDarkMode && styles.primaryTextDark]} numberOfLines={1}>
                      {item.name}
                    </Text>
                    {isActive ? (
                      <ActivityIndicator size="small" color="#3e577a" />
                    ) : isDone ? (
                      <MaterialIcons name="check-circle" size={18} color="#10b981" />
                    ) : isError ? (
                      <MaterialIcons name="error-outline" size={18} color="#ef4444" />
                    ) : (
                      <MaterialIcons name="schedule" size={18} color="#94a3b8" />
                    )}
                  </View>
                  <View style={styles.uploadMetaRow}>
                    <Text style={[styles.uploadStatus, isDone && styles.uploadStatusDone, isError && styles.uploadStatusError, item.status === 'queued' && styles.uploadStatusQueued]}>
                      {isActive ? `Uploading... ${(item.progress * 100).toFixed(0)}%` : isDone ? 'Completed' : isError ? 'Failed' : 'Queued'}
                    </Text>
                    <Text style={[styles.uploadSize, isDarkMode && styles.secondaryTextDark]}>
                      {item.sizeLabel}
                    </Text>
                  </View>
                  <Text style={[styles.uploadDetail, isDarkMode && styles.secondaryTextDark]} numberOfLines={1}>
                    {item.detail}
                  </Text>
                  <View style={[styles.progressTrack, isDarkMode && styles.progressTrackDark]}>
                    <View style={[styles.progressFill, { width: progressWidth, backgroundColor: isError ? '#ef4444' : isDone ? '#10b981' : '#3e577a' }]} />
                  </View>
                </View>
              </View>
            );
          })
        ) : (
          <View style={[styles.emptyCard, isDarkMode && styles.surfaceDark, isDarkMode && styles.borderDark]}>
            <MaterialIcons name="cloud-upload" size={28} color="#3e577a" />
            <Text style={[styles.emptyCardTitle, isDarkMode && styles.primaryTextDark]}>No active uploads</Text>
            <Text style={[styles.emptyCardText, isDarkMode && styles.secondaryTextDark]}>
              Choose a source above to start uploading files.
            </Text>
          </View>
        )}

        {lastUpload ? (
          <TouchableOpacity
            style={[styles.secondaryButton, isDarkMode && styles.surfaceDark, isDarkMode && styles.borderDark]}
            onPress={() => router.push('/(app)/files')}
          >
            <Text style={[styles.secondaryButtonText, isDarkMode && styles.primaryTextDark]}>
              Open Files
            </Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
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
  containerDark: {
    backgroundColor: '#020617',
  },
  contentContainer: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#111827',
  },
  subtitle: {
    marginTop: 4,
    color: '#6b7280',
    fontSize: 14,
  },
  headerButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  dropZone: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: 'rgba(62, 87, 122, 0.28)',
    backgroundColor: 'rgba(62, 87, 122, 0.05)',
    borderRadius: 24,
    alignItems: 'center',
    paddingVertical: 34,
    paddingHorizontal: 20,
    marginTop: 12,
    marginBottom: 20,
  },
  dropZoneDark: {
    backgroundColor: 'rgba(62, 87, 122, 0.12)',
    borderColor: '#334155',
  },
  dropZoneIconWrap: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  dropZoneTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  dropZoneText: {
    marginTop: 6,
    fontSize: 13,
    color: '#6b7280',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    marginTop: 8,
    marginBottom: 12,
  },
  sourceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 20,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#eef2f7',
    marginBottom: 12,
  },
  sourceIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  sourceContent: {
    flex: 1,
  },
  sourceTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  sourceText: {
    marginTop: 4,
    color: '#6b7280',
    fontSize: 13,
  },
  uploadCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#eef2f7',
    overflow: 'hidden',
    position: 'relative',
    marginBottom: 12,
  },
  uploadEdge: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    height: 3,
    backgroundColor: '#3e577a',
  },
  uploadIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadBody: {
    flex: 1,
    marginLeft: 14,
  },
  uploadTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  uploadName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
  },
  uploadMetaRow: {
    marginTop: 6,
    marginBottom: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  uploadStatus: {
    fontSize: 12,
    fontWeight: '700',
    color: '#3e577a',
  },
  uploadStatusDone: {
    color: '#10b981',
  },
  uploadStatusQueued: {
    color: '#64748b',
  },
  uploadStatusError: {
    color: '#ef4444',
  },
  uploadSize: {
    fontSize: 12,
    color: '#6b7280',
  },
  uploadDetail: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 8,
  },
  progressTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: '#e5e7eb',
    overflow: 'hidden',
  },
  progressTrackDark: {
    backgroundColor: '#1f2937',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#3e577a',
  },
  emptyCard: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 20,
    paddingVertical: 28,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: '#eef2f7',
    marginBottom: 12,
  },
  emptyCardTitle: {
    marginTop: 10,
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  emptyCardText: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 20,
    color: '#6b7280',
    textAlign: 'center',
  },
  secondaryButton: {
    height: 50,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  secondaryButtonText: {
    color: '#111827',
    fontWeight: '700',
    fontSize: 14,
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
  borderDark: {
    borderColor: '#1e293b',
  },
});
