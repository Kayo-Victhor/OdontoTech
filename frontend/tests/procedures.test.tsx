import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../src/App';
import { AuthProvider, type UserRole } from '../src/auth/AuthProvider';
import { api } from '../src/services/api';
import type { CatalogProcedure } from '../src/services/procedures';

afterEach(cleanup);
const fixture = (): CatalogProcedure => ({ id: 'p1', name: 'Limpeza', description: 'Descrição do catálogo', defaultPrice: null, estimatedDurationMinutes: 30, isActive: true, createdAt: '2026-11-01T11:00:00.000Z', updatedAt: '2026-11-01T11:00:00.000Z' });
function setup(role: UserRole = 'ADMIN') {
  const rows = [fixture(), { ...fixture(), id: 'p2', name: 'Outro procedimento', isActive: false, defaultPrice: '0.00' }];
  const get = vi.spyOn(api, 'get').mockImplementation((url) => {
    if (url === '/auth/me') return Promise.resolve({ data: { user: { id: 'account', name: 'Pessoa Teste', role } } });
    if (url === '/admin/procedures') return Promise.resolve({ data: { items: structuredClone(rows), hasMore: false } });
    return Promise.reject(new Error('Unexpected route'));
  });
  const post = vi.spyOn(api, 'post').mockImplementation(async (_url, input) => { const row = { ...fixture(), ...input, defaultPrice: input.defaultPrice === null ? null : input.defaultPrice === '0' ? '0.00' : input.defaultPrice, id: 'p3' }; rows.push(row); return { data: { procedure: row } }; });
  const patch = vi.spyOn(api, 'patch').mockImplementation(async (url, input) => { const row = rows.find((item) => url.endsWith(item.id))!; Object.assign(row, input); return { data: { procedure: row } }; });
  render(<MemoryRouter initialEntries={['/admin/procedimentos']}><AuthProvider><App /></AuthProvider></MemoryRouter>);
  return { get, post, patch, rows };
}
it('lista catálogo real, inativos, preço não configurado e zero explícito', async () => {
  const s = setup(); await screen.findByRole('button', { name: 'Editar Limpeza' }); expect(screen.getByText('Não configurado')).toBeDefined(); expect(screen.getByText('R$ 0,00')).toBeDefined(); expect(screen.getByText('Desativado')).toBeDefined(); expect(s.get).toHaveBeenCalledWith('/admin/procedures', expect.objectContaining({ params: { search: '', page: 1, pageSize: 10 } }));
});
it('cadastra com preço decimal e duração opcional, atualizando a lista', async () => {
  const s = setup(); await userEvent.type(await screen.findByLabelText('Nome do procedimento'), 'Restauração'); await userEvent.type(screen.getByLabelText('Preço padrão (R$)'), '125,50');
  await userEvent.click(screen.getByRole('button', { name: 'Cadastrar procedimento' })); await screen.findByText('Procedimento cadastrado.');
  expect(s.post).toHaveBeenCalledWith('/admin/procedures', { name: 'Restauração', description: null, defaultPrice: '125.50', estimatedDurationMinutes: null, isActive: true }); await screen.findByRole('button', { name: 'Editar Restauração' });
});
it('preço vazio não é convertido em zero', async () => {
  const s = setup(); await userEvent.type(await screen.findByLabelText('Nome do procedimento'), 'Sem preço'); await userEvent.click(screen.getByRole('button', { name: 'Cadastrar procedimento' })); await screen.findByText('Procedimento cadastrado.'); expect(s.post).toHaveBeenCalledWith('/admin/procedures', expect.objectContaining({ defaultPrice: null }));
});
it('edita nome, descrição, preço e duração pela API', async () => {
  const s = setup(); await userEvent.click(await screen.findByRole('button', { name: 'Editar Limpeza' }));
  fireEvent.change(screen.getByLabelText('Preço padrão (R$)'), { target: { value: '80.25' } }); fireEvent.change(screen.getByLabelText('Descrição (opcional)'), { target: { value: 'Descrição atualizada' } }); fireEvent.change(screen.getByLabelText('Duração estimada em minutos (opcional)'), { target: { value: '45' } });
  await userEvent.click(screen.getByRole('button', { name: 'Guardar alterações' })); await screen.findByText('Procedimento atualizado.'); expect(s.patch).toHaveBeenCalledWith('/admin/procedures/p1', expect.objectContaining({ defaultPrice: '80.25', description: 'Descrição atualizada', estimatedDurationMinutes: 45 })); await screen.findByText('R$ 80,25');
});
it('desativação pela linha exige confirmação e preserva o item na lista', async () => {
  const s = setup(); await userEvent.click(await screen.findByRole('button', { name: 'Desativar Limpeza' })); expect(s.patch).not.toHaveBeenCalled();
  const dialog = screen.getByRole('dialog', { name: 'Desativar procedimento?' }); expect(within(dialog).getByText(/registos históricos serão preservados/)).toBeDefined();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar desativação' })); await screen.findByRole('button', { name: 'Ativar Limpeza' }); expect(s.patch).toHaveBeenCalledWith('/admin/procedures/p1', { isActive: false });
});
it('desativação pelo formulário também exige confirmação', async () => {
  const s = setup(); await userEvent.click(await screen.findByRole('button', { name: 'Editar Limpeza' })); await userEvent.click(screen.getByLabelText('Disponível no catálogo ativo')); await userEvent.click(screen.getByRole('button', { name: 'Guardar alterações' }));
  await screen.findByRole('dialog', { name: 'Desativar procedimento?' }); expect(s.patch).not.toHaveBeenCalled(); await userEvent.click(screen.getByRole('button', { name: 'Fechar' })); expect(s.patch).not.toHaveBeenCalled();
});
it('ativa item desativado sem alterar preço', async () => {
  const s = setup(); await userEvent.click(await screen.findByRole('button', { name: 'Ativar Outro procedimento' })); await screen.findByRole('button', { name: 'Desativar Outro procedimento' }); expect(s.patch).toHaveBeenCalledWith('/admin/procedures/p2', { isActive: true }); expect(s.rows[1].defaultPrice).toBe('0.00');
});
it('rejeita preços negativos e com precisão excessiva antes de enviar', async () => {
  const s = setup(); await userEvent.type(await screen.findByLabelText('Nome do procedimento'), 'Teste');
  for (const value of ['-1', '1.005']) { fireEvent.change(screen.getByLabelText('Preço padrão (R$)'), { target: { value } }); await userEvent.click(screen.getByRole('button', { name: 'Cadastrar procedimento' })); await screen.findByRole('alert'); }
  expect(s.post).not.toHaveBeenCalled();
});
it('falha da API mantém formulário e apresenta erro sem sucesso falso', async () => {
  const s = setup(); s.post.mockRejectedValue({ isAxiosError: true, response: { status: 400 } }); await userEvent.type(await screen.findByLabelText('Nome do procedimento'), 'Teste'); await userEvent.click(screen.getByRole('button', { name: 'Cadastrar procedimento' })); await screen.findByRole('alert'); expect(screen.queryByText('Procedimento cadastrado.')).toBeNull(); expect((screen.getByLabelText('Nome do procedimento') as HTMLInputElement).value).toBe('Teste');
});
it.each(['DENTIST', 'RECEPTIONIST', 'PATIENT'] as const)('%s não acede à gestão do catálogo', async (role) => {
  const s = setup(role); await screen.findByText('Olá, Pessoa Teste'); expect(s.get.mock.calls.some(([url]) => url.startsWith('/admin/procedures'))).toBe(false); expect(screen.queryByLabelText('Preço padrão (R$)')).toBeNull();
});
it('trata falha de listagem com nova tentativa e não mostra catálogo vazio fictício', async () => {
  const s = setup(); const original = s.get.getMockImplementation()!; s.get.mockImplementation((url, options) => url === '/admin/procedures' ? Promise.reject(new Error('offline')) : original(url, options));
  await screen.findByRole('alert'); expect(screen.queryByText('Nenhum procedimento encontrado.')).toBeNull(); s.get.mockImplementation(original); await userEvent.click(screen.getByRole('button', { name: 'Tentar carregar catálogo novamente' })); await screen.findByRole('button', { name: 'Editar Limpeza' });
});
it('busca é enviada à API e submissão pendente bloqueia duplicação', async () => {
  const s = setup(); fireEvent.change(await screen.findByLabelText('Pesquisar procedimentos'), { target: { value: 'Limpeza' } }); await waitFor(() => expect(s.get).toHaveBeenCalledWith('/admin/procedures', expect.objectContaining({ params: { search: 'Limpeza', page: 1, pageSize: 10 } })));
  let finish!: (value: any) => void; s.post.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })); await userEvent.type(screen.getByLabelText('Nome do procedimento'), 'Novo procedimento'); await userEvent.click(screen.getByRole('button', { name: 'Cadastrar procedimento' })); const button = screen.getByRole('button', { name: 'A guardar…' }) as HTMLButtonElement; expect(button.disabled).toBe(true); await userEvent.click(button); expect(s.post).toHaveBeenCalledTimes(1); finish({ data: { procedure: fixture() } }); await screen.findByText('Procedimento cadastrado.');
});
