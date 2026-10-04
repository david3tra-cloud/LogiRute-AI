import React from 'react';
import ReactDOM from 'react-dom/client';
import { Analytics } from '@vercel/analytics/react';
import App from './App';
import { supabase } from './lib/supabase';

const {
  data: { subscription: recoverySubscription },
} = supabase.auth.onAuthStateChange((event) => {
  if (event === "PASSWORD_RECOVERY") {
    try {
      window.sessionStorage.setItem(
        "logiroute_password_recovery_pending_v1",
        "1",
      );
    } catch {
      // No bloquear el arranque si sessionStorage no está disponible.
    }
  }
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    recoverySubscription.unsubscribe();
  });
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
    <Analytics />
  </React.StrictMode>
);