import 'react-native-get-random-values';
import 'react-native-gesture-handler';
import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthProvider } from './src/context/AuthContext';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { AlertProvider } from './src/context/AlertContext';
import { NotificationProvider } from './src/context/NotificationContext';
import { LightTimerProvider } from './src/context/LightTimerContext';
import { NavScrollProvider } from './src/context/NavScrollContext';
import AppNavigator from './src/navigation/index';

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
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <ThemeProvider>
          <AlertProvider>
            <NotificationProvider>
              <LightTimerProvider>
                <NavScrollProvider>
                  <AppContent />
                </NavScrollProvider>
              </LightTimerProvider>
            </NotificationProvider>
          </AlertProvider>
        </ThemeProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
