import { useRef, useState, type FormEvent } from "react";
import { CalendarDays, Mail, Phone, UserRound } from "lucide-react";
import { PasswordFields } from '../components/PasswordFields';
import { accountErrorMessage, accountFields, registerPatient } from '../services/accounts';

export function RegisterPage({ onLogin, onRegistered }: { onLogin: () => void; onRegistered: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = new FormData(event.currentTarget);
    const fields = accountFields(form);
    if (fields.password !== fields.confirmPassword) { setError('As senhas devem coincidir.'); return; }
    submitting.current = true; setPending(true); setError('');
    try {
      await registerPatient({ ...fields,
        ...(form.get('phone') ? { phone: String(form.get('phone')).trim() } : {}),
        ...(form.get('birthDate') ? { birthDate: String(form.get('birthDate')) } : {}),
      });
      onRegistered();
    } catch (failure) { setError(accountErrorMessage(failure)); }
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
      <section className="login-content" aria-labelledby="register-title">
        <div className="login-header login-header--compact">
          <div className="logo-mark" aria-hidden="true">
            <svg fill="none" viewBox="0 0 64 68">
              <path d="M13 10.8C19.2 5.2 26.1 6.5 32 10.2C37.9 6.5 44.8 5.2 51 10.8C58.9 18 55.8 35.5 51.5 47.6C48.8 55.4 45.8 62 42.1 62C37.7 62 38.7 46.1 32 46.1C25.3 46.1 26.3 62 21.9 62C18.2 62 15.2 55.4 12.5 47.6C8.2 35.5 5.1 18 13 10.8Z" />
              <path d="M24 9.2C26.7 10.2 29.4 11.9 32 13.7C34.6 11.9 37.3 10.2 40 9.2" />
            </svg>
          </div>
          <p className="brand-name">
            Odonto<span>Tech</span>
          </p>
          <h1 id="register-title">Crie a sua conta</h1>
        </div>
        <form
          className="login-form registration-form"
          onSubmit={handleSubmit}
        >
          <label className="field">
            <span>Nome completo</span>
            <span className="field-control">
              <UserRound size={19} />
              <input name="name" autoComplete="name" minLength={2} maxLength={120} required />
            </span>
          </label>
          <label className="field">
            <span>Telefone</span>
            <span className="field-control">
              <Phone size={19} />
              <input name="phone" autoComplete="tel" maxLength={30} type="tel" />
            </span>
          </label>
          <label className="field">
            <span>E-mail</span>
            <span className="field-control">
              <Mail size={19} />
              <input name="email" autoComplete="email" maxLength={254} required type="email" />
            </span>
          </label>
          <label className="field">
            <span>Data de nascimento</span>
            <span className="field-control">
              <CalendarDays size={19} />
              <input name="birthDate" autoComplete="bday" max={new Date().toISOString().slice(0, 10)} type="date" />
            </span>
          </label>
          <PasswordFields />
          <button className="submit-button" disabled={pending} type="submit">
            {pending ? 'A criar conta…' : 'Criar conta'}
          </button>
          <p className="login-switch">
            Já tem uma conta?{" "}
            <button onClick={onLogin} type="button">
              Entrar
            </button>
          </p>
          {error && <p role="alert" className="form-message form-message--error">{error}</p>}
        </form>
      </section>
    </main>
  );
}
