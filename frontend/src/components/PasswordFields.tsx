import { useId, useRef, useState } from 'react';
import { Eye, EyeOff, LockKeyhole } from 'lucide-react';

export function PasswordFields() {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [visible, setVisible] = useState(false);
  const confirmRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const mismatch = Boolean(confirmation && password !== confirmation);
  function validateConfirmation(nextPassword: string, nextConfirmation: string) {
    confirmRef.current?.setCustomValidity(nextConfirmation && nextPassword !== nextConfirmation ? 'As senhas devem coincidir.' : '');
  }
  return <>
    <label className="field">
      <span id={`${hintId}-label`}>Palavra-passe</span>
      <span className="field-control">
        <LockKeyhole aria-hidden="true" size={19} />
        <input name="password" autoComplete="new-password" type={visible ? 'text' : 'password'} required minLength={12} maxLength={128}
          pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9]).{12,128}"
          aria-labelledby={`${hintId}-label`} aria-describedby={hintId} value={password} onChange={(event) => { setPassword(event.target.value); validateConfirmation(event.target.value, confirmation); }} />
        <button type="button" className="password-toggle" aria-label={visible ? 'Ocultar palavra-passe' : 'Mostrar palavra-passe'} onClick={() => setVisible((value) => !value)}>
          {visible ? <EyeOff size={19} /> : <Eye size={19} />}
        </button>
      </span>
      <small className="field-hint" id={hintId}>12 a 128 caracteres, com maiúscula, minúscula, número e símbolo.</small>
    </label>
    <label className="field">
      <span id={`${hintId}-confirmation-label`}>Confirmar palavra-passe</span>
      <span className="field-control">
        <LockKeyhole aria-hidden="true" size={19} />
        <input ref={confirmRef} name="confirmPassword" autoComplete="new-password" type={visible ? 'text' : 'password'} required maxLength={128}
          value={confirmation} aria-labelledby={`${hintId}-confirmation-label`} aria-invalid={mismatch} aria-describedby={mismatch ? `${hintId}-error` : undefined}
          onChange={(event) => { setConfirmation(event.target.value); validateConfirmation(password, event.target.value); }} />
      </span>
      {mismatch && <small className="field-error" id={`${hintId}-error`}>As senhas devem coincidir.</small>}
    </label>
  </>;
}
