import { useEffect, useRef, useState, type FormEvent } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { PasswordFields } from '../components/PasswordFields';
import { api } from '../services/api';
import { accountErrorMessage, accountFields, type InternalInput, type UserList } from '../services/accounts';
import { roleNames } from '../auth/AuthProvider';

export function AdminUsersPage() {
  const [role, setRole] = useState<'RECEPTIONIST' | 'DENTIST'>('RECEPTIONIST');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const submitting = useRef(false);
  const [formVersion, setFormVersion] = useState(0);
  const [listVersion, setListVersion] = useState(0);
  const [page, setPage] = useState(1);
  const [list, setList] = useState<UserList | null>(null);
  const [listError, setListError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setListError(''); setList(null);
    api.get<UserList>('/admin/users', { params: { page, pageSize: 10 }, signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setList(data); })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        setListError(accountErrorMessage(failure));
        if (axios.isAxiosError(failure) && failure.response?.status === 403) setForbidden(true);
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, listVersion]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = new FormData(event.currentTarget);
    const common = accountFields(form);
    if (common.password !== common.confirmPassword) { setError('As senhas devem coincidir.'); return; }
    const input: InternalInput = role === 'RECEPTIONIST' ? { ...common, role } : {
      ...common, role, croNumber: String(form.get('croNumber') || '').trim(), croState: String(form.get('croState') || '').trim().toUpperCase(),
      ...(form.get('specialty') ? { specialty: String(form.get('specialty')).trim() } : {}),
    };
    submitting.current = true; setPending(true); setError(''); setSuccess('');
    try {
      await api.post('/admin/users', input);
      setSuccess('Conta criada com sucesso.');
      setFormVersion((value) => value + 1); setPage(1); setListVersion((value) => value + 1);
    } catch (failure) {
      setError(accountErrorMessage(failure));
      if (axios.isAxiosError(failure) && failure.response?.status === 403) setForbidden(true);
    } finally { submitting.current = false; setPending(false); }
  }

  return <main className="admin-page">
    <header className="admin-header"><div><p className="brand-name">Odonto<span>Tech</span></p><h1>Gestão de utilizadores</h1></div><Link to="/admin">Voltar à minha área</Link></header>
    {forbidden ? <p role="alert">Acesso não autorizado. Apenas administradores podem gerir utilizadores.</p> : <div className="admin-columns">
      <section aria-labelledby="create-user-title"><form key={formVersion} className="login-form registration-form" onSubmit={handleSubmit}>
        <h2 id="create-user-title">Nova conta interna</h2>
        <fieldset disabled={pending} className="account-fields">
          <label className="field"><span>Tipo de conta</span><select name="role" value={role} onChange={(event) => setRole(event.target.value as 'RECEPTIONIST' | 'DENTIST')}><option value="RECEPTIONIST">Recepção</option><option value="DENTIST">Dentista</option></select></label>
          <label className="field"><span>Nome completo</span><span className="field-control"><input name="name" autoComplete="off" required minLength={2} maxLength={120} /></span></label>
          <label className="field"><span>E-mail</span><span className="field-control"><input name="email" type="email" autoComplete="off" required maxLength={254} /></span></label>
          {role === 'DENTIST' && <div className="professional-fields">
            <label className="field"><span>Número do CRO</span><span className="field-control"><input name="croNumber" required maxLength={30} pattern="[A-Za-z0-9.\-]+" /></span></label>
            <label className="field"><span>Estado do CRO</span><span className="field-control"><input name="croState" required minLength={2} maxLength={2} pattern="[A-Za-z]{2}" placeholder="SP" /></span></label>
            <label className="field"><span>Especialidade (opcional)</span><span className="field-control"><input name="specialty" maxLength={120} /></span></label>
          </div>}
          <PasswordFields />
          <button className="submit-button" type="submit" disabled={pending}>{pending ? 'A criar conta…' : 'Criar conta interna'}</button>
        </fieldset>
      </form>{error && <p role="alert" className="form-message form-message--error">{error}</p>}{success && <p role="status" className="form-message">{success}</p>}</section>
      <section aria-labelledby="users-title" className="users-section"><h2 id="users-title">Contas registadas</h2>
        {loading ? <p role="status">A carregar utilizadores…</p> : listError ? <><p role="alert">{listError}</p><button className="text-button" onClick={() => setListVersion((value) => value + 1)}>Tentar novamente</button></> : list && <>
          <div className="users-table-container"><table className="users-table"><thead><tr><th>Nome / E-mail</th><th>Perfil</th><th>Estado</th></tr></thead><tbody>{list.users.map((user) => <tr key={user.id}><td>{user.name}<span>{user.email}</span></td><td>{roleNames[user.role]}</td><td>{user.status === 'ACTIVE' ? 'Ativo' : 'Inativo'}</td></tr>)}</tbody></table></div>
          {list.total === 0 && <p>Nenhuma conta encontrada.</p>}
          <nav className="pagination" aria-label="Paginação de utilizadores"><button disabled={page === 1} onClick={() => setPage((value) => value - 1)}>Anterior</button><span>Página {page}</span><button disabled={page * list.pageSize >= list.total} onClick={() => setPage((value) => value + 1)}>Próxima</button></nav>
        </>}
      </section>
    </div>}
  </main>;
}
