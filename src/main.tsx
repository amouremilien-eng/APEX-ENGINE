import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './themes.css'
import './styles/themes.css'
import App from './App.tsx'
import { useUserStore } from './store/useUserStore'

function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { user } = useUserStore();
  
  useEffect(() => {
    // ✅ Protection ajoutée avec user?.theme et valeur par défaut
    const theme = user?.theme || 'salesin';
    document.documentElement.setAttribute('data-theme', theme);
  }, [user?.theme]);
  
  return <>{children}</>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
