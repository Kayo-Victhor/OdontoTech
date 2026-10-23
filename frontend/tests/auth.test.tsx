import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { App } from '../src/App';
import { AuthProvider, type SessionUser } from '../src/auth/AuthProvider';
import { api } from '../src/services/api';

afterEach(cleanup);
const admin: SessionUser = { id: '1', name: 'Admin Teste', role: 'ADMIN' };
const unauthorized = { isAxiosError: true, response: { status: 401 } };
function Location() { return <span data-testid="path">{useLocation().pathname}</span>; }
function mount(path = '/login') {
  return render(<MemoryRouter initialEntries={[path]}><AuthProvider><App /><Location /></AuthProvider></MemoryRouter>);
}
function noSession() { return vi.spyOn(api, 'get').mockRejectedValue(unauthorized); }
async function credentials(email = 'admin@example.test') {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('E-mail'), email);
  await user.type(screen.getByLabelText('Palavra-passe', { selector: 'input' }), 'TestPassword!123');
  return user;
}

describe('autenticação integrada', () => {
  const profiles = [
    ['ADMIN', 'Administrador', '/admin'],
    ['RECEPTIONIST', 'Recepção', '/recepcao'],
    ['DENTIST', 'Dentista', '/dentista'],
    ['PATIENT', 'Paciente', '/paciente'],
  ] as const;
  it('apresenta quatro opções com os valores reais e seleção exclusivamente visual', async () => {
    noSession(); mount(); await screen.findByLabelText('E-mail');
    for (const [role, label] of profiles) {
      const button = screen.getByRole('button', { name: label, exact: true });
      expect(button.getAttribute('value')).toBe(role);
      await userEvent.click(button);
      expect(button.getAttribute('aria-pressed')).toBe('true');
      expect(screen.getByTestId('path').textContent).toBe('/login');
    }
  });
  it.each(profiles)('login de %s (%s) encaminha para %s', async (role, label, path) => {
    const get = noSession(); const session = { id: role.toLowerCase(), name: `Conta ${label}`, role };
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: { user: session } });
    const email = `${role.toLowerCase()}@example.test`;
    mount(); const user = await credentials(email); await user.click(screen.getByRole('button', { name: label, exact: true }));
    get.mockResolvedValue({ data: { user: session } }); await user.click(screen.getByRole('button', { name: 'Entrar', exact: true }));
    await screen.findByText(`Olá, Conta ${label}`);
    expect(screen.getByTestId('path').textContent).toBe(path);
    expect(post).toHaveBeenCalledWith('/auth/login', { email, password: 'TestPassword!123' });
    if (role === 'DENTIST') expect(screen.getByRole('link', { name: 'Abrir agenda' }).getAttribute('href')).toBe('/agenda');
  });
  it.each(profiles)('selecionar outro perfil não altera o destino nem os privilégios de %s', async (role, label, path) => {
    const get = noSession(); const session = { id: role.toLowerCase(), name: `Conta ${label}`, role };
    vi.spyOn(api, 'post').mockResolvedValue({ data: { user: session } });
    mount(); const user = await credentials();
    await user.click(screen.getByRole('button', { name: role === 'ADMIN' ? 'Dentista' : 'Administrador', exact: true }));
    get.mockResolvedValue({ data: { user: session } }); await user.click(screen.getByRole('button', { name: 'Entrar', exact: true }));
    await screen.findByText(`Olá, Conta ${label}`); expect(screen.getByTestId('path').textContent).toBe(path);
    expect(Boolean(screen.queryByRole('link', { name: 'Gerir utilizadores' }))).toBe(role === 'ADMIN');
  });
  it('envia somente credenciais, mostra carregamento e usa o papel do servidor', async () => {
    const get = noSession();
    let resolveLogin!: (value: any) => void;
    const post = vi.spyOn(api, 'post').mockImplementation(() => new Promise((resolve) => { resolveLogin = resolve; }));
    mount(); const user = await credentials();
    await user.click(screen.getByRole('button', { name: 'Paciente', exact: true }));
    await user.click(screen.getByRole('button', { name: 'Entrar', exact: true }));
    expect((await screen.findByRole('button', { name: 'A entrar…' }) as HTMLButtonElement).disabled).toBe(true);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/auth/login', { email: 'admin@example.test', password: 'TestPassword!123' });
    get.mockResolvedValue({ data: { user: admin } });
    resolveLogin({ data: { user: admin } });
    await screen.findByText('Olá, Admin Teste');
    expect(screen.getByTestId('path').textContent).toBe('/admin');
    expect(api.defaults.withCredentials).toBe(true);
    expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
  });
  it('mostra erro genérico e mantém login sem sessão', async () => {
    noSession(); vi.spyOn(api, 'post').mockRejectedValue(unauthorized);
    mount(); const user = await credentials();
    await user.click(screen.getByRole('button', { name: 'Entrar', exact: true }));
    expect((await screen.findByRole('alert')).textContent).toBe('E-mail ou senha inválidos');
    expect(screen.getByTestId('path').textContent).toBe('/login');
  });
  it('aguarda /me antes de mostrar conteúdo privado e restaura sessão', async () => {
    let resolveMe!: (value: any) => void;
    vi.spyOn(api, 'get').mockImplementation(() => new Promise((resolve) => { resolveMe = resolve; }));
    mount('/admin'); expect(screen.getByRole('status').textContent).toBe('A verificar a sessão…');
    expect(screen.queryByText('Olá, Admin Teste')).toBeNull();
    resolveMe({ data: { user: admin } }); await screen.findByText('Olá, Admin Teste');
  });
  it('redireciona rota protegida sem autenticação para login', async () => {
    noSession(); mount('/admin'); await screen.findByLabelText('E-mail');
    expect(screen.getByTestId('path').textContent).toBe('/login');
  });
  it.each(['RECEPTIONIST', 'DENTIST', 'PATIENT'] as const)('redireciona %s para a sua área', async (role) => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: { user: { ...admin, role } } });
    mount('/admin'); await screen.findByText('Olá, Admin Teste');
    expect(screen.getByTestId('path').textContent).toBe({ RECEPTIONIST: '/recepcao', DENTIST: '/dentista', PATIENT: '/paciente' }[role]);
  });
  it('logout limpa a sessão apenas após confirmação da API', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: { user: admin } });
    const post = vi.spyOn(api, 'post').mockResolvedValue({ status: 204 });
    mount('/admin'); await userEvent.click(await screen.findByRole('button', { name: 'Sair' }));
    await screen.findByLabelText('E-mail'); expect(post).toHaveBeenCalledWith('/auth/logout');
  });
  it('indisponibilidade na inicialização oferece nova tentativa sem mostrar páginas privadas', async () => {
    const get = vi.spyOn(api, 'get').mockRejectedValue(new Error('offline'));
    mount('/admin'); await screen.findByRole('alert'); expect(screen.queryByText('Olá, Admin Teste')).toBeNull();
    get.mockResolvedValue({ data: { user: admin } });
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await screen.findByText('Olá, Admin Teste');
  });
  it('401 nas chamadas protegidas encerra estado local', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: { user: admin } });
    mount('/admin'); await screen.findByText('Olá, Admin Teste');
    window.dispatchEvent(new Event('auth:unauthorized'));
    await waitFor(() => expect(screen.getByTestId('path').textContent).toBe('/login'));
  });
});
