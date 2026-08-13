import 'react-native-get-random-values';
import 'react-native-gesture-handler';
import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { AuthProvider } from './src/context/AuthContext';
import { HouseholdProvider } from './src/context/HouseholdContext';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { AlertProvider } from './src/context/AlertContext';
import { NotificationProvider } from './src/context/NotificationContext';
import { LightTimerProvider } from './src/context/LightTimerContext';
import { NavScrollProvider } from './src/context/NavScrollContext';
import { FabPositionProvider } from './src/context/FabPositionContext';
import AppNavigator from './src/navigation/index';
import { installWebViewportFix } from './src/utils/webViewportFix';

function AppContent() {
  const { theme } = useTheme();
  return (
    <>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <AppNavigator />
    </>
  );
}

export default function App() {
  useEffect(() => installWebViewportFix(), []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <AuthProvider>
          <HouseholdProvider>
          <ThemeProvider>
            <AlertProvider>
              <NotificationProvider>
                <LightTimerProvider>
                  <NavScrollProvider>
                    <FabPositionProvider>
                      <AppContent />
                    </FabPositionProvider>
                  </NavScrollProvider>
                </LightTimerProvider>
              </NotificationProvider>
            </AlertProvider>
          </ThemeProvider>
          </HouseholdProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
