import { Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { useState, type ReactNode } from 'react';
import { useAuth, roleNames, rolePaths, type UserRole } from './auth/AuthProvider';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { authErrorMessage } from './services/api';
import { AdminUsersPage } from './pages/AdminUsersPage';

function SessionCheck({ children }: { children: ReactNode }) {
  const { initializing, initializationError, retry } = useAuth();
  if (initializing) return <main className="session-state" role="status">A verificar a sessão…</main>;
  if (initializationError) return <main className="session-state"><p role="alert">Não foi possível verificar a sessão.</p><button className="submit-button" onClick={retry}>Tentar novamente</button></main>;
  return children;
}
function PublicPage({ registration = false }: { registration?: boolean }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  if (user) return <Navigate to={rolePaths[user.role]} replace />;
  return registration ? <RegisterPage onLogin={() => navigate('/login')} onRegistered={() => navigate('/login', { replace: true, state: { registered: true } })} /> : <LoginPage onRegister={() => navigate('/registro')} />;
}
function PrivatePage({ role, children }: { role: UserRole; children?: ReactNode }) {
  const { user, logout } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== role) return <Navigate to={rolePaths[user.role]} replace />;
  if (children) return children;
  async function handleLogout() {
    if (pending) return;
    setPending(true); setError('');
    try { await logout(); } catch (failure) { setError(authErrorMessage(failure)); } finally { setPending(false); }
  }
  return <main className="session-state"><p className="brand-name">Odonto<span>Tech</span></p><h1>Olá, {user.name}</h1><p>Área de {roleNames[user.role]}</p>{role === 'ADMIN' ? <Link to="/admin/utilizadores">Gerir utilizadores</Link> : <p>O seu painel estará disponível em breve.</p>}<button className="submit-button" disabled={pending} onClick={handleLogout}>{pending ? 'A sair…' : 'Sair'}</button>{error && <p role="alert">{error}</p>}</main>;
}
export function App() {
  return <SessionCheck><Routes>
    <Route path="/login" element={<PublicPage />} />
    <Route path="/registro" element={<PublicPage registration />} />
    <Route path="/admin" element={<PrivatePage role="ADMIN" />} />
    <Route path="/admin/utilizadores" element={<PrivatePage role="ADMIN"><AdminUsersPage /></PrivatePage>} />
    <Route path="/recepcao" element={<PrivatePage role="RECEPTIONIST" />} />
    <Route path="/dentista" element={<PrivatePage role="DENTIST" />} />
    <Route path="/paciente" element={<PrivatePage role="PATIENT" />} />
    <Route path="*" element={<Navigate to="/login" replace />} />
  </Routes></SessionCheck>;
}
