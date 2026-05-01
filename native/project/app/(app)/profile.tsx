import { View, Text, TouchableOpacity, ScrollView, Alert, StyleSheet, Switch, Modal } from 'react-native';
import { useMemo, useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import api from '@/services/api';
import { useUIStore } from '@/store/uiStore';

function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const value = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / 1024 ** value;
  return `${size.toFixed(size >= 10 || value === 0 ? 0 : 1)} ${units[value]}`;
}

export default function ProfileScreen() {
  const { user, logout, setUser } = useAuthStore();
  const isDarkMode = useUIStore((state) => state.isDarkMode);
  const setDarkMode = useUIStore((state) => state.setDarkMode);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [showPlanModal, setShowPlanModal] = useState(false);
  const storageUsed = user?.stats?.storage_used || 0;
  const storageLimit = user?.stats?.storage_limit || 0;
  const storagePercent = storageLimit > 0 ? Math.min((storageUsed / storageLimit) * 100, 100) : 0;
  const plan = user?.plan;
  const isProPlan = useMemo(
    () => Boolean(plan?.is_pro || user?.role === 'admin'),
    [plan?.is_pro, user?.role]
  );
  const currentPlanName = plan?.name || (isProPlan ? 'PRO Plan' : 'Free Plan');
  const currentPlanTag = isProPlan ? 'PRO' : 'FREE';
  const nextPlanLimit = 512 * 1024 * 1024 * 1024;
  const currentPlanFeatures = isProPlan
    ? ['Yuksek depolama limiti', 'Oncelikli dosya yonetimi', 'Gelismis paylasim altyapisi']
    : ['Temel depolama limiti', 'Standart dosya yukleme', 'Guvenli paylasim linkleri'];

  const handleLogout = () => {
    logout();
    router.replace('/(auth)/login');
  };

  const handlePlanAction = () => {
    (async () => {
      if (isProPlan) {
        Alert.alert('PRO Plan', 'Hesabin zaten PRO plan ozelliklerini kullaniyor.');
        return;
      }

      try {
        const upgradeResponse = await api.post('/billing/upgrade');
        const userResponse = await api.get('/auth/me');
        setUser(userResponse.data);
        setShowPlanModal(false);
        Alert.alert('Plan Yukseltildi', upgradeResponse.data?.message || 'PRO plan aktif edildi.');
      } catch (error: any) {
        Alert.alert('Upgrade Hatasi', error.response?.data?.error || 'PRO plan guncellenemedi.');
      }
    })();
  };

  const handleGenerateApiKey = async () => {
    try {
      const res = await api.post('/api-keys', { name: 'App Key ' + Date.now() });
      Alert.alert('API Key Generated', `Your new key:\n${res.data.key}`);
    } catch {
      Alert.alert('Error', 'Failed to generate key');
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, isDarkMode && styles.safeAreaDark]} edges={['top', 'left', 'right']}>
      <ScrollView
        style={[styles.container, isDarkMode && styles.containerDark]}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom + 104, 120) }]}
      >
        <View style={[styles.header, isDarkMode && styles.headerDark]}>
          <View style={styles.topBar}>
            <TouchableOpacity style={styles.topIconButton} onPress={() => router.back()}>
              <MaterialIcons name="arrow-back" size={22} color={isDarkMode ? '#f8fafc' : '#111827'} />
            </TouchableOpacity>
            <Text style={[styles.topTitle, isDarkMode && styles.primaryTextDark]}>Settings</Text>
            <TouchableOpacity style={styles.doneButton} onPress={() => router.back()}>
              <Text style={[styles.doneButtonText, isDarkMode && styles.doneButtonTextDark]}>Done</Text>
            </TouchableOpacity>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsRow}>
            <View style={[styles.tabPill, isDarkMode && styles.tabPillDark, styles.tabPillActive, isDarkMode && styles.tabPillActiveDark]}>
              <Text style={[styles.tabText, styles.tabTextActive]}>Profile</Text>
            </View>
            <View style={[styles.tabPill, isDarkMode && styles.tabPillDark]}>
              <Text style={[styles.tabText, isDarkMode && styles.secondaryTextDark]}>Billing</Text>
            </View>
            <View style={[styles.tabPill, isDarkMode && styles.tabPillDark]}>
              <Text style={[styles.tabText, isDarkMode && styles.secondaryTextDark]}>Team</Text>
            </View>
            <View style={[styles.tabPill, isDarkMode && styles.tabPillDark]}>
              <Text style={[styles.tabText, isDarkMode && styles.secondaryTextDark]}>Integrations</Text>
            </View>
          </ScrollView>
        </View>

        <View style={styles.content}>
          <View style={[styles.avatar, isDarkMode && styles.avatarDark]}>
            <Text style={styles.avatarText}>
              {user?.first_name?.[0]}{user?.last_name?.[0]}
            </Text>
            <View style={styles.cameraBadge}>
              <MaterialIcons name="photo-camera" size={16} color="white" />
            </View>
          </View>
          <Text style={[styles.changePhotoText, isDarkMode && styles.changePhotoTextDark]}>Change Photo</Text>
          <Text style={[styles.name, isDarkMode && styles.primaryTextDark]}>{user?.first_name} {user?.last_name}</Text>
          <Text style={[styles.username, isDarkMode && styles.secondaryTextDark]}>@{user?.username}</Text>
          <View style={styles.roleBadge}>
            <Text style={styles.roleText}>{user?.role}</Text>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, isDarkMode && styles.fieldLabelDark]}>FULL NAME</Text>
            <View style={[styles.fieldCard, isDarkMode && styles.cardDark]}>
              <MaterialIcons name="person" size={20} color={isDarkMode ? '#94a3b8' : '#9ca3af'} />
              <Text style={[styles.fieldValue, isDarkMode && styles.primaryTextDark]}>{user?.first_name} {user?.last_name}</Text>
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, isDarkMode && styles.fieldLabelDark]}>EMAIL ADDRESS</Text>
            <View style={[styles.fieldCard, isDarkMode && styles.cardDark]}>
              <MaterialIcons name="mail" size={20} color={isDarkMode ? '#94a3b8' : '#9ca3af'} />
              <Text style={[styles.fieldValue, isDarkMode && styles.primaryTextDark]}>{user?.email || '-'}</Text>
            </View>
          </View>

          <View style={[styles.storageCard, isDarkMode && styles.cardDark]}>
            <View style={styles.storageDecor} />
            <View style={styles.storageHeader}>
              <View style={styles.storageIconWrap}>
                <MaterialIcons name="cloud" size={20} color="#3e577a" />
              </View>
              <View style={styles.storageHeaderInfo}>
                <Text style={[styles.storageTitle, isDarkMode && styles.primaryTextDark]}>Storage</Text>
                <Text style={[styles.storagePlan, isDarkMode && styles.secondaryTextDark]}>{currentPlanName}</Text>
              </View>
              <View style={[styles.proBadge, isDarkMode && styles.proBadgeDark, isProPlan && styles.proBadgeActive]}>
                <Text style={[styles.proBadgeText, isDarkMode && styles.proBadgeTextDark, isProPlan && styles.proBadgeTextActive]}>{currentPlanTag}</Text>
              </View>
            </View>
            <View style={styles.storageSummaryRow}>
              <Text style={[styles.storageValue, isDarkMode && styles.primaryTextDark]}>
                {formatBytes(storageUsed)} <Text style={[styles.storageUsedLabel, isDarkMode && styles.secondaryTextDark]}>used</Text>
              </Text>
              <Text style={[styles.storageLimit, isDarkMode && styles.secondaryTextDark]}>{formatBytes(storageLimit)}</Text>
            </View>
            <View style={[styles.progressTrack, isDarkMode && styles.progressTrackDark]}>
              <View style={[styles.progressFill, { width: `${storagePercent}%` }]} />
            </View>
            <TouchableOpacity style={styles.upgradeButton} onPress={() => setShowPlanModal(true)}>
              <MaterialIcons name={isProPlan ? 'verified' : 'rocket-launch'} size={18} color="white" />
              <Text style={styles.upgradeButtonText}>{isProPlan ? 'Manage Plan' : 'Upgrade Plan'}</Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.planHighlightCard, isDarkMode && styles.cardDark]}>
            <View style={styles.planHighlightHeader}>
              <View>
                <Text style={[styles.planHighlightTitle, isDarkMode && styles.primaryTextDark]}>Plan Benefits</Text>
                <Text style={[styles.planHighlightSubtitle, isDarkMode && styles.secondaryTextDark]}>
                  {isProPlan ? 'Aktif avantajlarin' : 'PRO ile acilacak avantajlar'}
                </Text>
              </View>
              <View style={[styles.planPill, isProPlan ? styles.planPillActive : styles.planPillInactive]}>
                <Text style={styles.planPillText}>{currentPlanTag}</Text>
              </View>
            </View>
            {currentPlanFeatures.map((feature) => (
              <View key={feature} style={styles.planFeatureRow}>
                <MaterialIcons name="check-circle" size={18} color={isProPlan ? '#16a34a' : '#3e577a'} />
                <Text style={[styles.planFeatureText, isDarkMode && styles.primaryTextDark]}>{feature}</Text>
              </View>
            ))}
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionLabel, isDarkMode && styles.fieldLabelDark]}>PREFERENCES</Text>
            <View style={[styles.menuCard, isDarkMode && styles.cardDark]}>
              <TouchableOpacity style={[styles.menuItem, styles.borderBottom, isDarkMode && styles.borderBottomDark]}>
                <View style={[styles.menuIconWrap, isDarkMode && styles.menuIconWrapDark]}>
                  <MaterialIcons name="dark-mode" size={18} color={isDarkMode ? '#cbd5e1' : '#4b5563'} />
                </View>
                <Text style={[styles.menuText, isDarkMode && styles.primaryTextDark]}>Dark Mode</Text>
                <Switch
                  value={isDarkMode}
                  onValueChange={setDarkMode}
                  trackColor={{ false: '#cbd5e1', true: '#93c5fd' }}
                  thumbColor={isDarkMode ? '#1d4ed8' : '#ffffff'}
                />
              </TouchableOpacity>

              <TouchableOpacity style={[styles.menuItem, styles.borderBottom, isDarkMode && styles.borderBottomDark]}>
                <View style={[styles.menuIconWrap, isDarkMode && styles.menuIconWrapDark]}>
                  <MaterialIcons name="notifications" size={18} color={isDarkMode ? '#cbd5e1' : '#4b5563'} />
                </View>
                <Text style={[styles.menuText, isDarkMode && styles.primaryTextDark]}>Notifications</Text>
                <MaterialIcons name="chevron-right" size={22} color={isDarkMode ? '#64748b' : '#9ca3af'} />
              </TouchableOpacity>

              <TouchableOpacity style={styles.menuItem}>
                <View style={[styles.menuIconWrap, isDarkMode && styles.menuIconWrapDark]}>
                  <MaterialIcons name="lock" size={18} color={isDarkMode ? '#cbd5e1' : '#4b5563'} />
                </View>
                <Text style={[styles.menuText, isDarkMode && styles.primaryTextDark]}>Security</Text>
                <MaterialIcons name="chevron-right" size={22} color={isDarkMode ? '#64748b' : '#9ca3af'} />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionLabel, isDarkMode && styles.fieldLabelDark]}>OVERVIEW</Text>
            <View style={[styles.statsBox, isDarkMode && styles.cardDark]}>
              <View style={styles.row}>
                <Text style={[styles.rowLabel, isDarkMode && styles.secondaryTextDark]}>Files Uploaded</Text>
                <Text style={[styles.rowValue, isDarkMode && styles.primaryTextDark]}>{user?.stats?.file_count || 0}</Text>
              </View>
              <View style={styles.row}>
                <Text style={[styles.rowLabel, isDarkMode && styles.secondaryTextDark]}>Total Downloads</Text>
                <Text style={[styles.rowValue, isDarkMode && styles.primaryTextDark]}>{user?.stats?.download_count || 0}</Text>
              </View>
            </View>
          </View>

          {user?.role === 'admin' && (
            <View style={styles.section}>
              <Text style={[styles.sectionLabel, isDarkMode && styles.fieldLabelDark]}>ADMIN CONTROLS</Text>
              <View style={[styles.menuCard, isDarkMode && styles.cardDark]}>
                <TouchableOpacity style={[styles.menuItem, styles.borderBottom, isDarkMode && styles.borderBottomDark]} onPress={handleGenerateApiKey}>
                  <View style={[styles.menuIconWrap, isDarkMode && styles.menuIconWrapDark]}>
                    <MaterialIcons name="vpn-key" size={18} color="#3e577a" />
                  </View>
                  <Text style={[styles.menuText, isDarkMode && styles.primaryTextDark]}>Generate API Key</Text>
                  <MaterialIcons name="chevron-right" size={22} color={isDarkMode ? '#64748b' : '#9ca3af'} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.menuItem}
                  onPress={() =>
                    router.push({
                      pathname: '/(app)/files',
                      params: { mode: 'trash', refresh: String(Date.now()) },
                    })
                  }
                >
                  <View style={[styles.menuIconWrap, isDarkMode && styles.menuIconWrapDark]}>
                    <MaterialIcons name="delete" size={18} color="#ef4444" />
                  </View>
                  <Text style={[styles.menuText, isDarkMode && styles.primaryTextDark]}>System Trash</Text>
                  <MaterialIcons name="chevron-right" size={22} color={isDarkMode ? '#64748b' : '#9ca3af'} />
                </TouchableOpacity>
              </View>
            </View>
          )}

          <View style={styles.section}>
            <View style={[styles.menuCard, isDarkMode && styles.cardDark]}>
              <TouchableOpacity
                style={[styles.menuItem, styles.borderBottom, isDarkMode && styles.borderBottomDark]}
                onPress={() =>
                  router.push({
                    pathname: '/(app)/files',
                    params: { mode: 'trash', refresh: String(Date.now()) },
                  })
                }
              >
                <View style={[styles.menuIconWrap, isDarkMode && styles.menuIconWrapDark]}>
                  <MaterialIcons name="delete-outline" size={18} color={isDarkMode ? '#cbd5e1' : '#4b5563'} />
                </View>
                <Text style={[styles.menuText, isDarkMode && styles.primaryTextDark]}>Trash Bin</Text>
                <MaterialIcons name="chevron-right" size={22} color={isDarkMode ? '#64748b' : '#9ca3af'} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.menuItem} onPress={handleLogout}>
                <View style={[styles.menuIconWrap, { backgroundColor: '#fee2e2' }]}>
                  <MaterialIcons name="logout" size={18} color="#ef4444" />
                </View>
                <Text style={[styles.menuText, { color: '#ef4444' }]}>Sign Out</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </ScrollView>

      <Modal
        visible={showPlanModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowPlanModal(false)}
      >
        <View style={styles.planModalOverlay}>
          <View style={[styles.planModalCard, isDarkMode && styles.cardDark]}>
            <View style={styles.planModalHandle} />
            <View style={styles.planModalHeader}>
              <View>
                <Text style={[styles.planModalTitle, isDarkMode && styles.primaryTextDark]}>Upgrade to PRO</Text>
                <Text style={[styles.planModalSubtitle, isDarkMode && styles.secondaryTextDark]}>
                  Daha fazla depolama ve gelismis yonetim ozellikleri
                </Text>
              </View>
              <TouchableOpacity onPress={() => setShowPlanModal(false)} style={[styles.planModalClose, isDarkMode && styles.menuIconWrapDark]}>
                <MaterialIcons name="close" size={18} color={isDarkMode ? '#f8fafc' : '#111827'} />
              </TouchableOpacity>
            </View>

            <View style={styles.planCompareRow}>
              <View style={[styles.planCompareCard, isDarkMode && styles.menuIconWrapDark]}>
                <Text style={[styles.planCompareLabel, isDarkMode && styles.secondaryTextDark]}>Current</Text>
                <Text style={[styles.planCompareTitle, isDarkMode && styles.primaryTextDark]}>{currentPlanName}</Text>
                <Text style={[styles.planCompareValue, isDarkMode && styles.primaryTextDark]}>{formatBytes(storageLimit)}</Text>
                <Text style={[styles.planCompareHint, isDarkMode && styles.secondaryTextDark]}>Mevcut depolama limiti</Text>
              </View>
              <View style={[styles.planCompareCard, styles.planCompareCardPrimary]}>
                <Text style={styles.planCompareLabelPrimary}>Recommended</Text>
                <Text style={styles.planCompareTitlePrimary}>PRO Plan</Text>
                <Text style={styles.planCompareValuePrimary}>{formatBytes(nextPlanLimit)}</Text>
                <Text style={styles.planCompareHintPrimary}>Yuksek limit ve oncelikli deneyim</Text>
              </View>
            </View>

            <View style={[styles.planListCard, isDarkMode && styles.menuIconWrapDark]}>
              <View style={styles.planFeatureRow}>
                <MaterialIcons name="bolt" size={18} color="#3e577a" />
                <Text style={[styles.planFeatureText, isDarkMode && styles.primaryTextDark]}>Daha yuksek depolama limiti</Text>
              </View>
              <View style={styles.planFeatureRow}>
                <MaterialIcons name="share" size={18} color="#3e577a" />
                <Text style={[styles.planFeatureText, isDarkMode && styles.primaryTextDark]}>Gelismis paylasim altyapisi icin hazirlik</Text>
              </View>
              <View style={styles.planFeatureRow}>
                <MaterialIcons name="cloud-upload" size={18} color="#3e577a" />
                <Text style={[styles.planFeatureText, isDarkMode && styles.primaryTextDark]}>Buyuk dosyalar icin daha uygun plan yapisi</Text>
              </View>
            </View>

            <TouchableOpacity style={styles.upgradeButton} onPress={handlePlanAction}>
              <MaterialIcons name={isProPlan ? 'verified' : 'workspace-premium'} size={18} color="white" />
              <Text style={styles.upgradeButtonText}>{isProPlan ? 'Current Plan Active' : 'Request PRO Upgrade'}</Text>
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
  container: {
    flex: 1,
  },
  containerDark: {
    backgroundColor: '#020617',
  },
  scrollContent: {
    flexGrow: 1,
  },
  header: {
    backgroundColor: '#f9fafb',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerDark: {
    backgroundColor: '#020617',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  topIconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  doneButton: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  doneButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#3e577a',
  },
  doneButtonTextDark: {
    color: '#93c5fd',
  },
  tabsRow: {
    gap: 8,
  },
  tabPill: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: '#eef2f7',
  },
  tabPillDark: {
    backgroundColor: '#0f172a',
  },
  tabPillActive: {
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 1,
  },
  tabPillActiveDark: {
    backgroundColor: '#1e293b',
    shadowOpacity: 0,
    elevation: 0,
  },
  tabText: {
    color: '#6b7280',
    fontWeight: '600',
    fontSize: 13,
  },
  tabTextActive: {
    color: '#3e577a',
  },
  content: {
    padding: 16,
    paddingTop: 8,
    gap: 16,
    alignItems: 'stretch',
  },
  avatar: {
    width: 112,
    height: 112,
    backgroundColor: '#3e577a',
    borderRadius: 56,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginTop: 8,
    borderWidth: 4,
    borderColor: '#ffffff',
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 4,
  },
  avatarDark: {
    borderColor: '#1e293b',
    shadowOpacity: 0.24,
  },
  cameraBadge: {
    position: 'absolute',
    right: 2,
    bottom: 2,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#3e577a',
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderColor: '#ffffff',
  },
  avatarText: {
    fontSize: 36,
    fontWeight: 'bold',
    color: 'white',
  },
  changePhotoText: {
    textAlign: 'center',
    color: '#3e577a',
    fontWeight: '600',
    marginTop: -6,
  },
  changePhotoTextDark: {
    color: '#93c5fd',
  },
  name: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1f2937',
    textAlign: 'center',
  },
  username: {
    color: '#6b7280',
    marginTop: 4,
    textAlign: 'center',
  },
  roleBadge: {
    backgroundColor: '#dbeafe',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 9999,
    marginTop: 8,
    alignSelf: 'center',
  },
  roleText: {
    color: '#3e577a',
    fontWeight: '500',
    textTransform: 'capitalize',
  },
  fieldGroup: {
    gap: 8,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9ca3af',
    letterSpacing: 1,
    marginLeft: 4,
  },
  fieldLabelDark: {
    color: '#64748b',
  },
  fieldCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#ffffff',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  cardDark: {
    backgroundColor: '#0f172a',
    borderColor: '#1e293b',
  },
  fieldValue: {
    flex: 1,
    color: '#111827',
    fontWeight: '600',
  },
  primaryTextDark: {
    color: '#f8fafc',
  },
  secondaryTextDark: {
    color: '#94a3b8',
  },
  storageCard: {
    backgroundColor: '#ffffff',
    borderRadius: 24,
    padding: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#eef2f7',
    position: 'relative',
  },
  storageDecor: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    right: -28,
    top: -32,
    backgroundColor: 'rgba(62, 87, 122, 0.08)',
  },
  storageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  storageIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  storageHeaderInfo: {
    flex: 1,
  },
  storageTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  storagePlan: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
  },
  proBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: '#f3f4f6',
  },
  proBadgeDark: {
    backgroundColor: '#111827',
  },
  proBadgeActive: {
    backgroundColor: '#dbeafe',
  },
  proBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4b5563',
  },
  proBadgeTextActive: {
    color: '#1d4ed8',
  },
  proBadgeTextDark: {
    color: '#cbd5e1',
  },
  storageSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 12,
  },
  storageUsedLabel: {
    fontSize: 14,
    fontWeight: '400',
    color: '#6b7280',
  },
  storageLimit: {
    color: '#6b7280',
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  rowLabel: {
    color: '#4b5563',
    fontWeight: '500',
  },
  rowValue: {
    fontWeight: 'bold',
    color: '#1f2937',
  },
  storageValue: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#1f2937',
  },
  progressTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: '#e5e7eb',
    overflow: 'hidden',
    marginBottom: 16,
  },
  progressTrackDark: {
    backgroundColor: '#1e293b',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#3e577a',
  },
  upgradeButton: {
    height: 46,
    borderRadius: 14,
    backgroundColor: '#3e577a',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  upgradeButtonText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  planHighlightCard: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#eef2f7',
    padding: 18,
    gap: 12,
  },
  planHighlightHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  planHighlightTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  planHighlightSubtitle: {
    marginTop: 4,
    fontSize: 12,
    color: '#6b7280',
  },
  planPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  planPillActive: {
    backgroundColor: '#dcfce7',
  },
  planPillInactive: {
    backgroundColor: '#ede9fe',
  },
  planPillText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#3e577a',
  },
  planFeatureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  planFeatureText: {
    flex: 1,
    color: '#111827',
    fontWeight: '500',
  },
  planModalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
  },
  planModalCard: {
    backgroundColor: '#f8fafc',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 32,
    gap: 16,
  },
  planModalHandle: {
    width: 48,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#cbd5e1',
    alignSelf: 'center',
  },
  planModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  planModalTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#111827',
  },
  planModalSubtitle: {
    marginTop: 4,
    color: '#6b7280',
  },
  planModalClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  planCompareRow: {
    flexDirection: 'row',
    gap: 12,
  },
  planCompareCard: {
    flex: 1,
    borderRadius: 18,
    backgroundColor: '#ffffff',
    padding: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  planCompareCardPrimary: {
    backgroundColor: '#3e577a',
    borderColor: '#3e577a',
  },
  planCompareLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6b7280',
    textTransform: 'uppercase',
  },
  planCompareLabelPrimary: {
    fontSize: 12,
    fontWeight: '700',
    color: '#dbeafe',
    textTransform: 'uppercase',
  },
  planCompareTitle: {
    marginTop: 12,
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  planCompareTitlePrimary: {
    marginTop: 12,
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
  planCompareValue: {
    marginTop: 10,
    fontSize: 24,
    fontWeight: '800',
    color: '#111827',
  },
  planCompareValuePrimary: {
    marginTop: 10,
    fontSize: 24,
    fontWeight: '800',
    color: '#ffffff',
  },
  planCompareHint: {
    marginTop: 8,
    fontSize: 12,
    color: '#6b7280',
  },
  planCompareHintPrimary: {
    marginTop: 8,
    fontSize: 12,
    color: '#dbeafe',
  },
  planListCard: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    padding: 16,
    gap: 14,
  },
  section: {
    gap: 10,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#9ca3af',
    letterSpacing: 1,
    marginLeft: 4,
  },
  menuCard: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#eef2f7',
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  borderBottom: {
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  borderBottomDark: {
    borderBottomColor: '#1e293b',
  },
  menuIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuIconWrapDark: {
    backgroundColor: '#111827',
  },
  menuText: {
    flex: 1,
    marginLeft: 14,
    color: '#374151',
    fontWeight: '500',
  },
  statsBox: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#eef2f7',
    padding: 16,
    gap: 10,
  },
});
