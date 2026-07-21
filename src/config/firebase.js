import { Platform } from 'react-native';
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey:            process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain:        process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId:         process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket:     process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId:             process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);

// Web uses the browser bundle (getAuth handles indexedDB persistence).
// Native uses the RN bundle (Metro override in metro.config.js) with AsyncStorage.
export const auth = Platform.OS === 'web'
  ? getAuth(app)
  : (() => {
      const { initializeAuth, getReactNativePersistence } = require('firebase/auth');
      const AsyncStorage = require('@react-native-async-storage/async-storage').default;
      return initializeAuth(app, {
        persistence: getReactNativePersistence(AsyncStorage),
      });
    })();

export const SPOONACULAR_API_KEY = process.env.EXPO_PUBLIC_SPOONACULAR_API_KEY;
