import React, { createContext, useContext, useState, useCallback } from 'react';
import ToastNotification from '../components/ToastNotification';

const NotificationContext = createContext(null);

export function NotificationProvider({ children }) {
  const [toast, setToast] = useState({ visible: false, title: '', body: '', type: 'info' });

  const notify = useCallback((title, body, options = {}) => {
    setToast({ visible: true, title, body, type: options.type || 'info' });
  }, []);

  const hideToast = useCallback(() => {
    setToast((t) => ({ ...t, visible: false }));
  }, []);

  return (
    <NotificationContext.Provider value={{ notify }}>
      {children}
      <ToastNotification
        visible={toast.visible}
        title={toast.title}
        body={toast.body}
        type={toast.type}
        onHide={hideToast}
      />
    </NotificationContext.Provider>
  );
}

export const useNotification = () => useContext(NotificationContext);
