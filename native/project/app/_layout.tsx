import { useRouter, useSegments, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useAuthStore } from '@/store/authStore';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  const { isAuthenticated } = useAuthStore();
  const segments = useSegments();
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    // Artificial delay to ensure navigation system is mounted
    const timer = setTimeout(() => {
      setIsReady(true);
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!isReady) return;

    const inAuthGroup = segments[0] === '(auth)';
    const inAppGroup = segments[0] === '(app)';
    
    // If user is authenticated but in auth group (login/register), send to dashboard
    if (isAuthenticated && inAuthGroup) {
      router.replace('/(app)/dashboard');
    } 
    // If user is NOT authenticated and trying to access app group, send to login
    else if (!isAuthenticated && inAppGroup) {
      router.replace('/(auth)/login');
    }
    // If user is at root (segments empty) and not authenticated, send to login
    else if (!isAuthenticated && (!segments || (segments as string[]).length === 0)) {
      router.replace('/(auth)/login');
    }
     // If user is at root and authenticated, send to dashboard
    else if (isAuthenticated && (!segments || (segments as string[]).length === 0)) {
      router.replace('/(app)/dashboard');
    }
  }, [isAuthenticated, segments, isReady, router]);

  if (!isReady) {
     return (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f5f5' }}>
           <ActivityIndicator size="large" color="#3e577a" />
        </View>
     );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerShown: false,
          gestureEnabled: true,
          fullScreenGestureEnabled: true,
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)/login" />
        <Stack.Screen name="(auth)/register" />
        <Stack.Screen name="(app)" />
      </Stack>
    </SafeAreaProvider>
  );
}
