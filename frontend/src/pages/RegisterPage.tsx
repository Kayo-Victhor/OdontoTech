import { useState, type FormEvent } from "react";
import { CalendarDays, Eye, EyeOff, LockKeyhole, Mail, Phone, UserRound } from "lucide-react";

export function RegisterPage({ onLogin }: { onLogin: () => void }) {
  const [submitted, setSubmitted] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
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
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            setSubmitted(true);
          }}
        >
          <label className="field">
            <span>Nome completo</span>
            <span className="field-control">
              <UserRound size={19} />
              <input name="name" required />
            </span>
          </label>
          <label className="field">
            <span>Telefone</span>
            <span className="field-control">
              <Phone size={19} />
              <input name="phone" required type="tel" />
            </span>
          </label>
          <label className="field">
            <span>E-mail</span>
            <span className="field-control">
              <Mail size={19} />
              <input name="email" required type="email" />
            </span>
          </label>
          <label className="field">
            <span>Data de nascimento</span>
            <span className="field-control">
              <CalendarDays size={19} />
              <input name="birthDate" required type="date" />
            </span>
          </label>
          <label className="field">
            <span>Palavra-passe</span>
            <span className="field-control">
              <LockKeyhole size={19} />
              <input autoComplete="new-password" name="password" required type={passwordVisible ? "text" : "password"} />
              <button aria-label={passwordVisible ? "Ocultar palavra-passe" : "Mostrar palavra-passe"} className="password-toggle" onClick={() => setPasswordVisible((visible) => !visible)} type="button">
                {passwordVisible ? <EyeOff size={19} /> : <Eye size={19} />}
              </button>
            </span>
          </label>
          <button className="submit-button" type="submit">
            Criar conta
          </button>
          <p className="login-switch">
            Já tem uma conta?{" "}
            <button onClick={onLogin} type="button">
              Entrar
            </button>
          </p>
          {submitted && (
            <p className="form-message">
              O seu cadastro será concluído quando a API estiver ligada.
            </p>
          )}
        </form>
      </section>
    </main>
  );
}
