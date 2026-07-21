import { createNavigationContainerRef } from '@react-navigation/native';

export const navigationRef = createNavigationContainerRef();

export function navigateTo(name, params) {
  if (navigationRef.isReady()) {
    navigationRef.navigate(name, params);
  }
}
