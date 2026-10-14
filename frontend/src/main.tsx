import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';

function App() { const [page, setPage] = useState<'login' | 'register'>('login'); return page === 'login' ? <LoginPage onRegister={() => setPage('register')} /> : <RegisterPage onLogin={() => setPage('login')} />; }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
