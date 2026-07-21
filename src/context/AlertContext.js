import React, { createContext, useContext, useRef, useState } from 'react';
import AlertModal from '../components/AlertModal';

const AlertContext = createContext(null);

export function AlertProvider({ children }) {
  const [config, setConfig] = useState(null);
  const resolveRef = useRef(null);

  const _show = (cfg) => new Promise((resolve) => {
    resolveRef.current = resolve;
    setConfig(cfg);
  });

  const handleClose = (result) => {
    setConfig(null);
    resolveRef.current?.(result);
    resolveRef.current = null;
  };

  // Single-button info / success / error / warning
  const showAlert = ({ title, message, type = 'info', icon, confirmLabel = 'OK' }) =>
    _show({ mode: 'alert', title, message, type, icon, confirmLabel });

  // Two-button confirmation — resolves true (confirm) or false (cancel)
  const showConfirm = ({ title, message, type = 'danger', icon, confirmLabel = 'Confirm', cancelLabel = 'Cancel' }) =>
    _show({ mode: 'confirm', title, message, type, icon, confirmLabel, cancelLabel });

  // Multi-option sheet — resolves with opt.value or null for cancel
  const showOptions = ({ title, message, type = 'warning', icon, options }) =>
    _show({ mode: 'options', title, message, type, icon, options });

  return (
    <AlertContext.Provider value={{ showAlert, showConfirm, showOptions }}>
      {children}
      {config && <AlertModal {...config} onClose={handleClose} />}
    </AlertContext.Provider>
  );
}

export const useAlert = () => useContext(AlertContext);
