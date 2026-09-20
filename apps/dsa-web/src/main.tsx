import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { ThemeProvider } from './components/theme/ThemeProvider'

const LocalApp = lazy(() => import('./App'))
const CloudApp = lazy(() => import('./cloud/CloudApp'))
const App = import.meta.env.VITE_DATA_BACKEND === 'supabase' ? CloudApp : LocalApp

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <Suspense fallback={<div>加载中…</div>}><App /></Suspense>
    </ThemeProvider>
  </StrictMode>,
)
