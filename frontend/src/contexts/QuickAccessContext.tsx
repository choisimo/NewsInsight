import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

interface QuickAccessContextType {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

const QuickAccessContext = createContext<QuickAccessContextType | undefined>(undefined);

export const useQuickAccess = () => {
  const context = useContext(QuickAccessContext);
  if (!context) {
    throw new Error('useQuickAccess must be used within QuickAccessProvider');
  }
  return context;
};

interface QuickAccessProviderProps {
  children: React.ReactNode;
}

export const QuickAccessProvider: React.FC<QuickAccessProviderProps> = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen(prev => !prev), []);

  // Keyboard shortcut: Ctrl/Cmd + Shift + K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'K') {
        e.preventDefault();
        toggle();
      }
      // ESC to close
      if (e.key === 'Escape' && isOpen) {
        close();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggle, close, isOpen]);

  return (
    <QuickAccessContext.Provider value={{ isOpen, open, close, toggle }}>
      {children}
    </QuickAccessContext.Provider>
  );
};
