import { useRef, useState, type FormEvent } from 'react';
import { useAuth, type UserRole } from '../auth/AuthProvider';
import { authErrorMessage } from '../services/api';
import { useLocation } from 'react-router-dom';
import {
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  Stethoscope,
  UserRound,
  UsersRound,
} from 'lucide-react';

const profiles: Array<{ role: UserRole; label: string; icon: typeof UserRound }> = [
  { role: 'ADMIN', label: 'Administrador', icon: UserRound },
  { role: 'RECEPTIONIST', label: 'Recepção', icon: UsersRound },
  { role: 'DENTIST', label: 'Dentista', icon: Stethoscope },
  { role: 'PATIENT', label: 'Paciente', icon: UserRound },
];

export function LoginPage({ onRegister }: { onRegister: () => void }) {
  // Preferência visual; a sessão e o destino usam exclusivamente o perfil da API.
  const [profile, setProfile] = useState<UserRole>('ADMIN');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState('');
  const { login } = useAuth();
  const location = useLocation();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = new FormData(event.currentTarget);
    submitting.current = true;
    setPending(true); setError('');
    try { await login(String(form.get('email') || '').trim().toLowerCase(), String(form.get('password') || '')); }
    catch (failure) { setError(authErrorMessage(failure)); }
    finally { submitting.current = false; setPending(false); }
  }

  return (
    <main className="login-page">
      <aside className="brand-panel" aria-hidden="true">
        <div className="brand-panel__orb" />
        <div className="brand-panel__line brand-panel__line--one" />
        <div className="brand-panel__line brand-panel__line--two" />
        <div className="brand-panel__tooth" />
      </aside>

      <section className="login-content" aria-labelledby="login-title">
        <div className="login-header">
          <div className="logo-mark" aria-hidden="true">
            <svg fill="none" viewBox="0 0 64 68" xmlns="http://www.w3.org/2000/svg">
              <path d="M13 10.8C19.2 5.2 26.1 6.5 32 10.2C37.9 6.5 44.8 5.2 51 10.8C58.9 18 55.8 35.5 51.5 47.6C48.8 55.4 45.8 62 42.1 62C37.7 62 38.7 46.1 32 46.1C25.3 46.1 26.3 62 21.9 62C18.2 62 15.2 55.4 12.5 47.6C8.2 35.5 5.1 18 13 10.8Z" />
              <path d="M24 9.2C26.7 10.2 29.4 11.9 32 13.7C34.6 11.9 37.3 10.2 40 9.2" />
            </svg>
          </div>
          <p className="brand-name">Odonto<span>Tech</span></p>
          <h1 id="login-title">A gestão da sua clínica, mais simples.</h1>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          {location.state?.registered === true && <p role="status" className="form-message registration-success">Conta criada com sucesso. Entre com o seu e-mail e senha.</p>}
          <fieldset className="profile-select">
            <legend className="sr-only">Perfil de acesso</legend>
            {profiles.map(({ role, label, icon: Icon }) => (
              <button
                className={profile === role ? 'profile-option profile-option--active' : 'profile-option'}
                key={role}
                value={role}
                aria-pressed={profile === role}
                onClick={() => setProfile(role)}
                type="button"
              >
                <Icon aria-hidden="true" size={20} strokeWidth={2} />
                <span>{label}</span>
              </button>
            ))}
          </fieldset>

          <label className="field">
            <span>E-mail</span>
            <span className="field-control">
              <Mail aria-hidden="true" size={20} strokeWidth={1.9} />
              <input autoComplete="email" name="email" placeholder="nome@clinica.com" required type="email" />
            </span>
          </label>

          <label className="field">
            <span>Palavra-passe</span>
            <span className="field-control">
              <LockKeyhole aria-hidden="true" size={20} strokeWidth={1.9} />
              <input autoComplete="current-password" name="password" placeholder="Introduza a sua palavra-passe" required type={isPasswordVisible ? 'text' : 'password'} />
              <button
                aria-label={isPasswordVisible ? 'Ocultar palavra-passe' : 'Mostrar palavra-passe'}
                className="password-toggle"
                onClick={() => setIsPasswordVisible((visible) => !visible)}
                type="button"
              >
                {isPasswordVisible ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </span>
          </label>

          <button className="submit-button" disabled={pending} type="submit">{pending ? 'A entrar…' : 'Entrar'}</button>
          <button className="forgot-password" onClick={() => setError('Para recuperar o acesso, contacte a administração da clínica.')} type="button">Esqueceu a palavra-passe?</button>
          <p className="login-switch">Ainda não tem uma conta? <button onClick={onRegister} type="button">Registre-se</button></p>

          {error && <p role="alert" className="form-message form-message--error">{error}</p>}
        </form>
      </section>
    </main>
  );
}
