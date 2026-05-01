import { View, Text, ScrollView, RefreshControl, TouchableOpacity, StyleSheet, Share, TextInput } from 'react-native';
import { useState, useCallback, useEffect } from 'react';
import { useAuthStore } from '@/store/authStore';
import api from '@/services/api';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useUIStore } from '@/store/uiStore';

function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const value = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / 1024 ** value;
  return `${size.toFixed(size >= 10 || value === 0 ? 0 : 1)} ${units[value]}`;
}

function getDisplayName(file: any) {
  return file?.display_name || file?.filename || '';
}

export default function Dashboard() {
  const { user, setUser } = useAuthStore();
  const isDarkMode = useUIStore((state) => state.isDarkMode);
  const [refreshing, setRefreshing] = useState(false);
  const [recentFiles, setRecentFiles] = useState<any[]>([]);
  const [frequentFolders, setFrequentFolders] = useState<any[]>([]);
  const [busyFileId, setBusyFileId] = useState<number | null>(null);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const storageUsed = user?.stats?.storage_used || 0;
  const storageLimit = user?.stats?.storage_limit || 0;
  const storagePercent = storageLimit > 0 ? Math.min((storageUsed / storageLimit) * 100, 100) : 0;

  const openFilesScreen = useCallback((mode?: 'favorites' | 'trash', extraParams?: string) => {
    const params: Record<string, string> = {};
    if (mode) {
      params.mode = mode;
    }
    if (extraParams) {
      const searchParams = new URLSearchParams(extraParams);
      searchParams.forEach((value, key) => {
        params[key] = value;
      });
    }
    return router.push({
      pathname: '/(app)/files',
      params,
    });
  }, [router]);

  const loadData = useCallback(async () => {
    try {
      const [userRes, filesRes, foldersRes] = await Promise.all([
        api.get('/auth/me'),
        api.get('/files?limit=5'),
        api.get('/folders?parent_id=root')
      ]);
      
      setUser(userRes.data);
      
      const nextRecentFiles = Array.isArray(filesRes.data) ? filesRes.data.slice(0, 5) : [];
      setRecentFiles(nextRecentFiles);
      setFrequentFolders(Array.isArray(foldersRes.data) ? foldersRes.data.slice(0, 4) : []);
    } catch (error: any) {
      if (error.response?.status !== 401) {
        console.error('Dashboard load error', error);
      }
      setRecentFiles([]);
      setFrequentFolders([]);
    }
  }, [setUser]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const handleRecentFileAction = useCallback(async (file: any, action: 'favorite' | 'trash' | 'share') => {
    setBusyFileId(file.id);
    try {
      if (action === 'favorite') {
        await api.post(`/files/${file.id}/favorite`);
        setRecentFiles((current) =>
          current.map((item) =>
            item.id === file.id ? { ...item, is_favorite: !item.is_favorite } : item
          )
        );
      } else if (action === 'trash') {
        await api.post(`/files/${file.id}/trash`);
        setRecentFiles((current) => current.filter((item) => item.id !== file.id));
      } else if (action === 'share') {
        const response = await api.post(`/files/${file.id}/share-link`);
        const shareUrl = response.data?.share_url;
        if (!shareUrl) {
          throw new Error('Share link unavailable');
        }
        await Share.share({
          message: `${file.filename}\n${shareUrl}`,
          url: shareUrl,
        });
      }
    } catch (error) {
      console.error('Recent file action error', error);
    } finally {
      setBusyFileId(null);
    }
  }, [loadData]);

  const openRecentFile = useCallback((file: any) => {
    const params: Record<string, string> = {
      preview_file_id: String(file.file_id || file.id),
      refresh: String(Date.now()),
    };

    if (file.folder_id) {
      params.folder_id = String(file.folder_id);
    }

    router.push({
      pathname: '/(app)/files',
      params,
    });
  }, [router]);

  const getFileIcon = useCallback((mimeType?: string, fileName?: string) => {
    const target = `${mimeType || ''} ${fileName || ''}`.toLowerCase();

    if (!target.trim()) {
      return { name: 'insert-drive-file' as const, bg: '#eef2ff', color: '#6366f1' };
    }
    if (target.includes('image') || /\.(png|jpg|jpeg|gif|webp)$/i.test(target)) {
      return { name: 'image' as const, bg: '#dbeafe', color: '#2563eb' };
    }
    if (target.includes('video') || /\.(mp4|mov|avi|mkv|webm)$/i.test(target)) {
      return { name: 'movie' as const, bg: '#ffedd5', color: '#ea580c' };
    }
    if (target.includes('pdf')) {
      return { name: 'picture-as-pdf' as const, bg: '#fee2e2', color: '#dc2626' };
    }
    if (target.includes('sheet') || target.includes('excel') || target.includes('csv')) {
      return { name: 'table-view' as const, bg: '#dcfce7', color: '#16a34a' };
    }
    return { name: 'description' as const, bg: '#ede9fe', color: '#7c3aed' };
  }, []);

  const folderColors = [
    { bg: '#fef3c7', color: '#d97706' },
    { bg: '#dcfce7', color: '#059669' },
    { bg: '#e0e7ff', color: '#4f46e5' },
    { bg: '#fce7f3', color: '#db2777' },
  ];

  return (
    <SafeAreaView style={[styles.safeArea, isDarkMode && styles.safeAreaDark]} edges={['top', 'left', 'right']}>
      <ScrollView
        style={[styles.container, isDarkMode && styles.containerDark]}
        contentContainerStyle={[styles.contentContainer, { paddingBottom: Math.max(insets.bottom + 104, 120) }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={isDarkMode ? '#93c5fd' : '#3e577a'} />
        }
      >
        <View style={styles.header}>
          <TouchableOpacity style={[styles.menuButton, isDarkMode && styles.surfaceDark, isDarkMode && styles.borderDark]} onPress={() => router.push('/(app)/files')}>
            <MaterialIcons name="menu" size={24} color={isDarkMode ? '#f8fafc' : '#1f2937'} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/(app)/profile')}>
            <View style={[styles.avatar, isDarkMode && styles.surfaceDark, isDarkMode && styles.borderDark]}>
              <Text style={styles.avatarText}>
                {user?.first_name?.[0]}{user?.last_name?.[0]}
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        <View style={styles.hero}>
          <Text style={[styles.welcomeText, isDarkMode && styles.primaryTextDark]}>Merhaba, {user?.first_name}</Text>
          <Text style={[styles.subText, isDarkMode && styles.secondaryTextDark]}>Dosyalarini hizlica bul, yonet ve paylas.</Text>
        </View>

        <TouchableOpacity style={[styles.searchBar, isDarkMode && styles.surfaceDark, isDarkMode && styles.borderDark]} onPress={() => router.push('/(app)/files')}>
          <MaterialIcons name="search" size={20} color="#9ca3af" />
          <TextInput
            editable={false}
            pointerEvents="none"
            style={[styles.searchInput, isDarkMode && styles.primaryTextDark]}
            placeholder="Dosya ve klasor ara..."
            placeholderTextColor="#9ca3af"
          />
          <View style={[styles.filterButton, isDarkMode && styles.subtleDark]}>
            <MaterialIcons name="tune" size={18} color={isDarkMode ? '#cbd5e1' : '#6b7280'} />
          </View>
        </TouchableOpacity>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statsScroll}>
          <View style={[styles.smallStatCard, isDarkMode && styles.surfaceDark, isDarkMode && styles.borderDark]}>
            <View style={[styles.iconContainer, { backgroundColor: '#dbeafe' }]}>
              <MaterialIcons name="folder" size={22} color="#3e577a" />
            </View>
            <Text style={[styles.statLabel, isDarkMode && styles.secondaryTextDark]}>Toplam Dosya</Text>
            <Text style={[styles.smallStatValue, isDarkMode && styles.primaryTextDark]}>{user?.stats?.file_count || 0}</Text>
          </View>

          <View style={[styles.storageHeroCard]}>
            <View style={styles.storageGlow} />
            <View style={styles.storageHeader}>
              <View style={styles.storageCloudIcon}>
                <MaterialIcons name="cloud" size={22} color="white" />
              </View>
            </View>
            <Text style={styles.storageHeroLabel}>Kullanilan Alan</Text>
            <View style={styles.storageHeroValues}>
              <Text style={styles.storageHeroValue}>{formatBytes(storageUsed)}</Text>
              <Text style={styles.storageHeroLimit}>/ {formatBytes(storageLimit)}</Text>
            </View>
            <View style={styles.storageTrackDark}>
              <View style={[styles.storageFillDark, { width: `${storagePercent}%` }]} />
            </View>
          </View>

          <View style={[styles.smallStatCard, isDarkMode && styles.surfaceDark, isDarkMode && styles.borderDark]}>
            <View style={[styles.iconContainer, { backgroundColor: '#ede9fe' }]}>
              <MaterialIcons name="share" size={22} color="#7c3aed" />
            </View>
            <Text style={[styles.statLabel, isDarkMode && styles.secondaryTextDark]}>Paylasilan Link</Text>
            <Text style={[styles.smallStatValue, isDarkMode && styles.primaryTextDark]}>{user?.stats?.shared_count || 0}</Text>
          </View>
        </ScrollView>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, isDarkMode && styles.primaryTextDark]}>Hizli Islemler</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actionsScroll}>
            <TouchableOpacity 
              style={[styles.actionButton, styles.primaryAction]}
              onPress={() => router.push('/(app)/upload')}
            >
              <MaterialIcons name="file-upload" size={24} color="white" />
              <Text style={styles.primaryActionText}>Upload</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[styles.actionButton, isDarkMode && styles.surfaceDark, isDarkMode && styles.borderDark]}
              onPress={() => openFilesScreen(undefined, 'folder_id=create')}
            >
              <MaterialIcons name="create-new-folder" size={24} color="#3e577a" />
              <Text style={[styles.actionText, isDarkMode && styles.primaryTextDark]}>New Folder</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.actionButton, isDarkMode && styles.surfaceDark, isDarkMode && styles.borderDark]}
              onPress={() => openFilesScreen('favorites')}
            >
              <MaterialIcons name="star" size={24} color="#eab308" />
              <Text style={[styles.actionText, isDarkMode && styles.primaryTextDark]}>Favorites</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.actionButton, isDarkMode && styles.surfaceDark, isDarkMode && styles.borderDark]}
              onPress={() => openFilesScreen('trash')}
            >
              <MaterialIcons name="delete-outline" size={24} color="#ef4444" />
              <Text style={[styles.actionText, isDarkMode && styles.primaryTextDark]}>Trash</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, isDarkMode && styles.primaryTextDark]}>Sik Kullanilan</Text>
            <TouchableOpacity onPress={() => router.push('/(app)/files')}>
              <Text style={styles.seeAllText}>Tumunu Gor</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.folderGrid}>
            {frequentFolders.length === 0 ? (
              <View style={[styles.placeholderCard, isDarkMode && styles.surfaceDark, isDarkMode && styles.borderDark]}>
                <Text style={[styles.emptyText, isDarkMode && styles.secondaryTextDark]}>Henuz klasor yok</Text>
              </View>
            ) : (
              frequentFolders.map((folder, index) => {
                const accent = folderColors[index % folderColors.length];
                return (
                  <TouchableOpacity
                    key={folder.id}
                    style={[styles.folderCard, isDarkMode && styles.surfaceDark, isDarkMode && styles.borderDark]}
                    onPress={() => router.push(`/(app)/files?folder_id=${folder.id}&refresh=${Date.now()}`)}
                  >
                    <View style={[styles.folderIconWrap, { backgroundColor: accent.bg }]}>
                      <MaterialIcons name="folder" size={28} color={accent.color} />
                    </View>
                    <Text style={[styles.folderCardTitle, isDarkMode && styles.primaryTextDark]} numberOfLines={1}>{folder.name}</Text>
                    <Text style={[styles.folderCardMeta, isDarkMode && styles.secondaryTextDark]}>{folder.file_count || 0} oge</Text>
                  </TouchableOpacity>
                );
              })
            )}
          </View>
        </View>

        <View>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, isDarkMode && styles.primaryTextDark]}>Son Aktiviteler</Text>
            <TouchableOpacity onPress={() => router.push('/(app)/files')}>
              <Text style={styles.seeAllText}>See All</Text>
            </TouchableOpacity>
          </View>
          
          <View style={[styles.recentFilesCard, isDarkMode && styles.surfaceDark, isDarkMode && styles.borderDark]}>
            {recentFiles.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={[styles.emptyText, isDarkMode && styles.secondaryTextDark]}>No files uploaded yet</Text>
              </View>
            ) : (
              recentFiles.map((file, index) => (
                <TouchableOpacity 
                  key={file.id}
                  style={[styles.fileItem, isDarkMode && styles.fileItemDark, index === recentFiles.length - 1 && styles.lastFileItem]}
                  onPress={() => openRecentFile(file)}
                >
                  <View style={[styles.fileIcon, { backgroundColor: getFileIcon(file.mime_type, file.filename).bg }]}>
                    <MaterialIcons 
                      name={getFileIcon(file.mime_type, file.filename).name}
                      size={24} 
                      color={getFileIcon(file.mime_type, file.filename).color}
                    />
                  </View>
                  <View style={styles.fileInfo}>
                    <Text style={[styles.fileName, isDarkMode && styles.primaryTextDark]} numberOfLines={1}>{getDisplayName(file)}</Text>
                    <Text style={[styles.fileMeta, isDarkMode && styles.secondaryTextDark]}>
                      {formatBytes(file.file_size)} • {new Date(file.upload_date).toLocaleDateString()}
                    </Text>
                  </View>
                  <View style={styles.fileActions}>
                    <TouchableOpacity style={[styles.fileActionButton, isDarkMode && styles.subtleDark, isDarkMode && styles.borderDark]} onPress={() => handleRecentFileAction(file, 'favorite')}>
                      <MaterialIcons name={busyFileId === file.id ? 'hourglass-empty' : file.is_favorite ? 'star' : 'star-border'} size={18} color="#eab308" />
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.fileActionButton, isDarkMode && styles.subtleDark, isDarkMode && styles.borderDark]} onPress={() => handleRecentFileAction(file, 'share')} disabled={busyFileId === file.id}>
                      <MaterialIcons name="share" size={18} color="#3e577a" />
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.fileActionButton, isDarkMode && styles.subtleDark, isDarkMode && styles.borderDark]} onPress={() => handleRecentFileAction(file, 'trash')} disabled={busyFileId === file.id}>
                      <MaterialIcons name="delete-outline" size={18} color="#ef4444" />
                    </TouchableOpacity>
                  </View>
                </TouchableOpacity>
              ))
            )}
          </View>
        </View>
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
  container: {
    flex: 1,
  },
  containerDark: {
    backgroundColor: '#020617',
  },
  contentContainer: {
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  menuButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#eef2f7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hero: {
    marginBottom: 18,
  },
  welcomeText: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1f2937',
  },
  subText: {
    color: '#6b7280',
    marginTop: 6,
    fontSize: 14,
  },
  searchBar: {
    height: 56,
    borderRadius: 20,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#eef2f7',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 20,
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
  filterButton: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#f9fafb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 40,
    height: 40,
    backgroundColor: '#ffffff',
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 2,
  },
  avatarText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#3e577a',
  },
  statsScroll: {
    gap: 16,
    marginBottom: 24,
  },
  smallStatCard: {
    width: 160,
    backgroundColor: 'white',
    padding: 18,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#eef2f7',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.04,
    shadowRadius: 14,
    elevation: 2,
  },
  storageHeroCard: {
    width: 190,
    backgroundColor: '#3e577a',
    borderRadius: 24,
    padding: 18,
    overflow: 'hidden',
  },
  storageGlow: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(255,255,255,0.12)',
    right: -24,
    top: -28,
  },
  storageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 18,
  },
  storageCloudIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  storageHeroLabel: {
    color: '#dbeafe',
    fontSize: 13,
    fontWeight: '500',
  },
  storageHeroValues: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginTop: 4,
    marginBottom: 12,
  },
  storageHeroValue: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '700',
  },
  storageHeroLimit: {
    color: '#cbd5e1',
    marginLeft: 4,
    marginBottom: 4,
  },
  storageTrackDark: {
    height: 6,
    backgroundColor: 'rgba(15, 23, 42, 0.25)',
    borderRadius: 999,
    overflow: 'hidden',
  },
  storageFillDark: {
    height: '100%',
    backgroundColor: '#ffffff',
    borderRadius: 999,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  smallStatValue: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1f2937',
    marginTop: 12,
  },
  statLabel: {
    color: '#6b7280',
    fontSize: 13,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1f2937',
  },
  actionsScroll: {
    gap: 16,
  },
  actionButton: {
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 18,
    alignItems: 'center',
    width: 112,
    borderWidth: 1,
    borderColor: '#eef2f7',
  },
  primaryAction: {
    backgroundColor: '#3e577a',
    borderColor: '#3e577a',
  },
  primaryActionText: {
    color: 'white',
    fontWeight: '500',
    marginTop: 8,
  },
  actionText: {
    color: '#374151',
    fontWeight: '500',
    marginTop: 8,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  seeAllText: {
    color: '#3e577a',
    fontWeight: '500',
  },
  folderGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  folderCard: {
    width: '48%',
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#eef2f7',
  },
  folderIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  folderCardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  folderCardMeta: {
    marginTop: 4,
    color: '#6b7280',
    fontSize: 12,
  },
  placeholderCard: {
    width: '100%',
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 28,
    borderWidth: 1,
    borderColor: '#eef2f7',
    alignItems: 'center',
  },
  recentFilesCard: {
    backgroundColor: 'white',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#eef2f7',
    padding: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  emptyState: {
    padding: 32,
    alignItems: 'center',
  },
  emptyText: {
    color: '#9ca3af',
  },
  fileItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f9fafb',
  },
  lastFileItem: {
    borderBottomWidth: 0,
  },
  fileIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  fileInfo: {
    flex: 1,
  },
  fileActions: {
    flexDirection: 'row',
    gap: 4,
    marginLeft: 8,
  },
  fileActionButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#eef2f7',
  },
  fileName: {
    color: '#1f2937',
    fontWeight: '700',
  },
  fileMeta: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 2,
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
  fileItemDark: {
    borderBottomColor: '#1e293b',
  },
});
