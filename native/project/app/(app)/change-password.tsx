import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useUIStore } from '@/store/uiStore';
import api from '@/services/api';

export default function ChangePasswordScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isDarkMode = useUIStore((state) => state.isDarkMode);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      Alert.alert('Eksik Bilgi', 'Tum alanlari doldur.');
      return;
    }

    if (newPassword.length < 6) {
      Alert.alert('Gecersiz Sifre', 'Yeni sifre en az 6 karakter olmali.');
      return;
    }

    if (newPassword !== confirmPassword) {
      Alert.alert('Uyusmuyor', 'Yeni sifre ve tekrar sifresi ayni olmali.');
      return;
    }

    try {
      setSaving(true);
      await api.put('/auth/password', {
        current_password: currentPassword,
        new_password: newPassword,
      });
      Alert.alert('Basarili', 'Sifren guncellendi.', [
        { text: 'Tamam', onPress: () => router.back() },
      ]);
    } catch (error: any) {
      Alert.alert('Sifre Degistirilemedi', error.response?.data?.error || 'Islem tamamlanamadi.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, isDarkMode && styles.safeAreaDark]} edges={['top', 'left', 'right']}>
      <ScrollView
        style={[styles.container, isDarkMode && styles.containerDark]}
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom + 40, 48) }]}
      >
        <View style={styles.header}>
          <TouchableOpacity style={[styles.iconButton, isDarkMode && styles.cardDark]} onPress={() => router.back()}>
            <MaterialIcons name="arrow-back" size={22} color={isDarkMode ? '#f8fafc' : '#111827'} />
          </TouchableOpacity>
          <Text style={[styles.title, isDarkMode && styles.primaryTextDark]}>Sifre Degistir</Text>
          <View style={styles.headerSpacer} />
        </View>

        <View style={[styles.card, isDarkMode && styles.cardDark]}>
          <Text style={[styles.label, isDarkMode && styles.secondaryTextDark]}>Mevcut Sifre</Text>
          <TextInput
            style={[styles.input, isDarkMode && styles.inputDark, isDarkMode && styles.primaryTextDark]}
            placeholder="Mevcut sifreni gir"
            placeholderTextColor={isDarkMode ? '#64748b' : '#9ca3af'}
            secureTextEntry
            value={currentPassword}
            onChangeText={setCurrentPassword}
          />

          <Text style={[styles.label, isDarkMode && styles.secondaryTextDark]}>Yeni Sifre</Text>
          <TextInput
            style={[styles.input, isDarkMode && styles.inputDark, isDarkMode && styles.primaryTextDark]}
            placeholder="Yeni sifreni gir"
            placeholderTextColor={isDarkMode ? '#64748b' : '#9ca3af'}
            secureTextEntry
            value={newPassword}
            onChangeText={setNewPassword}
          />

          <Text style={[styles.label, isDarkMode && styles.secondaryTextDark]}>Yeni Sifre Tekrar</Text>
          <TextInput
            style={[styles.input, isDarkMode && styles.inputDark, isDarkMode && styles.primaryTextDark]}
            placeholder="Yeni sifreyi tekrar gir"
            placeholderTextColor={isDarkMode ? '#64748b' : '#9ca3af'}
            secureTextEntry
            value={confirmPassword}
            onChangeText={setConfirmPassword}
          />

          <TouchableOpacity style={[styles.saveButton, saving && styles.saveButtonDisabled]} onPress={handleSave} disabled={saving}>
            {saving ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.saveButtonText}>Sifreyi Guncelle</Text>}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f8fafc',
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
  content: {
    padding: 16,
    gap: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerSpacer: {
    width: 40,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  cardDark: {
    backgroundColor: '#0f172a',
    borderColor: '#1e293b',
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6b7280',
    marginBottom: 8,
    marginTop: 12,
  },
  input: {
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#d1d5db',
    paddingHorizontal: 14,
    backgroundColor: '#f8fafc',
    color: '#111827',
  },
  inputDark: {
    backgroundColor: '#111827',
    borderColor: '#1e293b',
  },
  primaryTextDark: {
    color: '#f8fafc',
  },
  secondaryTextDark: {
    color: '#94a3b8',
  },
  saveButton: {
    marginTop: 20,
    height: 50,
    borderRadius: 14,
    backgroundColor: '#3e577a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonDisabled: {
    opacity: 0.65,
  },
  saveButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 15,
  },
});
