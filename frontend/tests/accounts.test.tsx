import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { AuthProvider, type SessionUser } from '../src/auth/AuthProvider';
import { App } from '../src/App';
import { api } from '../src/services/api';

afterEach(cleanup);
const admin: SessionUser = { id: 'admin', name: 'Admin Teste', role: 'ADMIN' };
const password = 'Strong-Test-Password!123';
const noSession = { isAxiosError: true, response: { status: 401 } };
const emptyList = { users: [], page: 1, pageSize: 10, total: 0 };
function Location() { return <span data-testid="path">{useLocation().pathname}</span>; }
function mount(path = '/registro', user: SessionUser | null = null) {
  vi.spyOn(api, 'get').mockImplementation((url) => {
    if (url === '/admin/users') return Promise.resolve({ data: emptyList });
    return user ? Promise.resolve({ data: { user } }) : Promise.reject(noSession);
  });
  render(<MemoryRouter initialEntries={[path]}><AuthProvider><App /><Location /></AuthProvider></MemoryRouter>);
}
async function fillCommon(confirm = password) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Nome completo'), 'Pessoa Teste');
  await user.type(screen.getByLabelText('E-mail'), 'person@example.test');
  await user.type(screen.getByLabelText('Palavra-passe', { selector: 'input' }), password);
  await user.type(screen.getByLabelText('Confirmar palavra-passe', { selector: 'input' }), confirm);
  return user;
}

it('cadastro envia dados reais à API e redireciona ao login com sucesso, sem iniciar sessão', async () => {
  const post = vi.spyOn(api, 'post').mockResolvedValue({ status: 201, data: { user: { id: 'new', name: 'Pessoa Teste', role: 'PATIENT' } } });
  mount(); const user = await fillCommon();
  await user.type(screen.getByLabelText('Telefone'), '(11) 99999-9999');
  await user.type(screen.getByLabelText('Data de nascimento'), '2000-01-02');
  await user.click(screen.getByRole('button', { name: 'Criar conta', exact: true }));
  await screen.findByText('Conta criada com sucesso. Entre com o seu e-mail e senha.');
  expect(screen.getByTestId('path').textContent).toBe('/login');
  expect(post).toHaveBeenCalledTimes(1);
  expect(post).toHaveBeenCalledWith('/auth/register', { name: 'Pessoa Teste', email: 'person@example.test', password, confirmPassword: password, phone: '(11) 99999-9999', birthDate: '2000-01-02' });
  expect(screen.queryByText('Olá, Pessoa Teste')).toBeNull();
});
it('confirmação divergente tem feedback acessível e impede envio', async () => {
  const post = vi.spyOn(api, 'post'); mount(); const user = await fillCommon('AnotherPassword!123');
  await user.click(screen.getByRole('button', { name: 'Criar conta', exact: true }));
  expect(screen.getByText('As senhas devem coincidir.')).toBeDefined();
  expect(screen.getByLabelText('Confirmar palavra-passe', { selector: 'input' }).getAttribute('aria-invalid')).toBe('true');
  expect(post).not.toHaveBeenCalled();
});
it('campos obrigatórios ausentes e senha curta não são enviados', async () => {
  const post = vi.spyOn(api, 'post'); mount();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Criar conta', exact: true }));
  expect(post).not.toHaveBeenCalled();
  await fillCommon();
  await user.clear(screen.getByLabelText('Palavra-passe', { selector: 'input' }));
  await user.type(screen.getByLabelText('Palavra-passe', { selector: 'input' }), 'Short!1');
  expect((screen.getByLabelText('Palavra-passe', { selector: 'input' }) as HTMLInputElement).checkValidity()).toBe(false);
  expect(post).not.toHaveBeenCalled();
});
it('cadastro mostra carregamento, bloqueia repetição e trata e-mail já utilizado', async () => {
  let rejectRequest!: (reason: unknown) => void;
  const post = vi.spyOn(api, 'post').mockImplementation(() => new Promise((_resolve, reject) => { rejectRequest = reject; }));
  mount(); const user = await fillCommon();
  await user.click(screen.getByRole('button', { name: 'Criar conta', exact: true }));
  const pending = await screen.findByRole('button', { name: 'A criar conta…' });
  expect((pending as HTMLButtonElement).disabled).toBe(true); await user.click(pending);
  expect(post).toHaveBeenCalledTimes(1);
  rejectRequest({ isAxiosError: true, response: { status: 409 } });
  expect((await screen.findByRole('alert')).textContent).toContain('já utilizados');
  expect(screen.getByTestId('path').textContent).toBe('/registro');
});
it('cadastro trata rate limit e falha inesperada', async () => {
  const post = vi.spyOn(api, 'post').mockRejectedValue({ isAxiosError: true, response: { status: 429 } });
  mount(); const user = await fillCommon();
  await user.click(screen.getByRole('button', { name: 'Criar conta', exact: true }));
  expect((await screen.findByRole('alert')).textContent).toContain('Muitas tentativas');
  post.mockRejectedValue(new Error('network private details'));
  await user.click(screen.getByRole('button', { name: 'Criar conta', exact: true }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Não foi possível concluir o cadastro'));
});
it('login e cadastro têm navegação pública sem ciclos', async () => {
  mount('/login'); const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Registre-se' }));
  await screen.findByRole('button', { name: 'Criar conta', exact: true });
  expect(screen.getByTestId('path').textContent).toBe('/registro');
  await user.click(screen.getByRole('button', { name: 'Entrar', exact: true }));
  await screen.findByLabelText('E-mail'); expect(screen.getByTestId('path').textContent).toBe('/login');
});
it('ADMIN cria rececionista sem campos profissionais nem opção de administrador', async () => {
  const post = vi.spyOn(api, 'post').mockResolvedValue({ status: 201 });
  mount('/admin/utilizadores', admin);
  const user = await fillCommon();
  expect(screen.queryByRole('option', { name: 'Administrador' })).toBeNull();
  expect(screen.queryByLabelText('Número do CRO')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Criar conta interna' }));
  await screen.findByText('Conta criada com sucesso.');
  expect(post).toHaveBeenCalledWith('/admin/users', { name: 'Pessoa Teste', email: 'person@example.test', password, confirmPassword: password, role: 'RECEPTIONIST' });
  expect((screen.getByLabelText('Palavra-passe', { selector: 'input' }) as HTMLInputElement).value).toBe('');
});
it('ADMIN seleciona dentista e envia todos os dados profissionais obrigatórios', async () => {
  const post = vi.spyOn(api, 'post').mockResolvedValue({ status: 201 });
  mount('/admin/utilizadores', admin); const user = await fillCommon();
  await user.selectOptions(screen.getByLabelText('Tipo de conta'), 'DENTIST');
  const cro = screen.getByLabelText('Número do CRO') as HTMLInputElement;
  expect(cro.required).toBe(true);
  await user.type(cro, '12345'); await user.type(screen.getByLabelText('Estado do CRO'), 'sp');
  await user.type(screen.getByLabelText('Especialidade (opcional)'), 'Ortodontia');
  await user.click(screen.getByRole('button', { name: 'Criar conta interna' }));
  await screen.findByText('Conta criada com sucesso.');
  expect(post).toHaveBeenCalledWith('/admin/users', { name: 'Pessoa Teste', email: 'person@example.test', password, confirmPassword: password, role: 'DENTIST', croNumber: '12345', croState: 'SP', specialty: 'Ortodontia' });
});
it('gestão administrativa bloqueia repetição e explica autorização recusada', async () => {
  let rejectRequest!: (reason: unknown) => void;
  const post = vi.spyOn(api, 'post').mockImplementation(() => new Promise((_resolve, reject) => { rejectRequest = reject; }));
  mount('/admin/utilizadores', admin); const user = await fillCommon();
  await user.click(screen.getByRole('button', { name: 'Criar conta interna' }));
  expect((await screen.findByRole('button', { name: 'A criar conta…' }) as HTMLButtonElement).disabled).toBe(true);
  expect(post).toHaveBeenCalledTimes(1);
  rejectRequest({ isAxiosError: true, response: { status: 403 } });
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Apenas administradores'));
  expect(screen.queryByLabelText('Nome completo')).toBeNull();
});
it.each(['PATIENT', 'RECEPTIONIST', 'DENTIST'] as const)('%s não acede à criação administrativa', async (role) => {
  mount('/admin/utilizadores', { ...admin, role });
  await screen.findByText('Olá, Admin Teste');
  expect(screen.queryByLabelText('Tipo de conta')).toBeNull();
  expect(api.get).not.toHaveBeenCalledWith('/admin/users', expect.anything());
});
it('admin pode abrir gestão a partir da sua área e listar contas', async () => {
  mount('/admin', admin);
  await userEvent.click(await screen.findByRole('link', { name: 'Gerir utilizadores' }));
  await screen.findByText('Contas registadas');
  await screen.findByText('Nenhuma conta encontrada.');
  expect(api.get).toHaveBeenCalledWith('/admin/users', expect.objectContaining({ params: { page: 1, pageSize: 10 } }));
});
