import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../src/App';
import { AuthProvider, type UserRole } from '../src/auth/AuthProvider';
import { api } from '../src/services/api';
import type { ClinicalContext, ClinicalHistory, ClinicalRecord } from '../src/services/clinical';

afterEach(cleanup);
const base = '/clinical/appointments/a1';
const record = (): ClinicalRecord => ({ id: 'r1', appointmentId: 'a1', notes: 'Notas reais devolvidas pela API', finalizedAt: null, createdAt: '2026-11-01T11:00:00.000Z', updatedAt: '2026-11-01T11:00:00.000Z', author: { name: 'Dra. Teste' }, procedures: [], addenda: [] });
function setup(options: { role?: UserRole; record?: ClinicalRecord | null; status?: ClinicalContext['appointment']['status']; error?: number } = {}) {
  const role = options.role ?? 'DENTIST'; let current = options.record === undefined ? record() : options.record;
  const appointment: ClinicalContext['appointment'] = { id: 'a1', startAt: '2026-11-01T11:00:00.000Z', endAt: '2026-11-01T12:00:00.000Z', status: options.status ?? 'IN_PROGRESS', patient: { id: 'p1', name: 'Paciente da API', birthDate: '2000-03-02', phone: '11999999999' }, dentist: { name: 'Dra. Teste' } };
  let history: ClinicalHistory = { items: [], hasMore: false, timeZone: 'America/Sao_Paulo' };
  const get = vi.spyOn(api, 'get').mockImplementation((url) => {
    if (url === '/auth/me') return Promise.resolve({ data: { user: { id: role.toLowerCase(), name: 'Pessoa Teste', role } } });
    if (url === base) return options.error ? Promise.reject({ isAxiosError: true, response: { status: options.error } }) : Promise.resolve({ data: { appointment, record: current, timeZone: 'America/Sao_Paulo' } });
    if (url === `${base}/history` || url === '/clinical/history') return Promise.resolve({ data: history });
    if (url === '/clinical/catalog') return Promise.resolve({ data: { items: [{ id: 'cat1', name: 'Procedimento do catálogo' }], hasMore: false } });
    return Promise.reject(new Error('Unexpected route'));
  });
  const patch = vi.spyOn(api, 'patch').mockImplementation(async (_url, data) => { current = { ...current!, notes: data.notes, updatedAt: '2026-11-01T11:01:00.000Z' }; return { data: { record: current } }; });
  const post = vi.spyOn(api, 'post').mockImplementation(async (url, data) => {
    if (url === base) current = record();
    if (url === `${base}/procedures`) current = { ...current!, updatedAt: '2026-11-01T11:02:00.000Z', procedures: [...current!.procedures, { id: 'cp1', procedureNameSnapshot: 'Procedimento do catálogo', toothOrRegion: data.toothOrRegion, descriptionSnapshot: data.description ?? null, notes: data.notes ?? null, createdAt: '2026-11-01T11:02:00.000Z' }] };
    if (url === `${base}/finalize`) current = { ...current!, updatedAt: '2026-11-01T11:03:00.000Z', finalizedAt: '2026-11-01T11:03:00.000Z' };
    if (url === `${base}/addenda`) current = { ...current!, addenda: [...current!.addenda, { id: 'ad1', content: data.content, createdAt: '2026-11-01T11:04:00.000Z', author: { name: 'Dra. Teste' } }] };
    return { data: { record: current } };
  });
  render(<MemoryRouter initialEntries={[role === 'PATIENT' ? '/paciente/historico' : '/prontuario/a1']}><AuthProvider><App /></AuthProvider></MemoryRouter>);
  return { get, patch, post, history: (data: ClinicalHistory) => { history = data; } };
}
async function readyProcedure() {
  await screen.findByLabelText('Notas clínicas');
  await userEvent.selectOptions(await screen.findByLabelText('Procedimento do catálogo (opcional)'), 'cat1');
  await userEvent.type(screen.getByLabelText('Dente / região'), '16');
  await userEvent.click(screen.getByRole('button', { name: 'Adicionar procedimento', exact: true }));
  await screen.findByText('Procedimento registado.');
}
it('carrega contexto e prontuário da API sem criar automaticamente um registo', async () => {
  const s = setup(); await screen.findByRole('heading', { name: 'Paciente da API' });
  expect(screen.getByText('Nascimento: 02/03/2000')).toBeDefined(); expect(screen.getByText('Contacto: 11999999999')).toBeDefined();
  expect(screen.getByText(/01\/11\/2026 08:00/)).toBeDefined(); expect(screen.getByLabelText('Notas clínicas').textContent).toBe('Notas reais devolvidas pela API'); expect(s.post).not.toHaveBeenCalled();
});
it('inicia rascunho explicitamente e guarda notas com a versão do servidor', async () => {
  const s = setup({ record: null }); await userEvent.click(await screen.findByRole('button', { name: 'Iniciar rascunho' }));
  await screen.findByText('Rascunho iniciado.'); fireEvent.change(screen.getByLabelText('Notas clínicas'), { target: { value: 'Novas notas' } });
  await userEvent.click(screen.getByRole('button', { name: 'Guardar rascunho' })); await screen.findByText('Rascunho guardado.');
  expect(s.post).toHaveBeenCalledWith(base, {}); expect(s.patch).toHaveBeenCalledWith(base, { notes: 'Novas notas', expectedUpdatedAt: '2026-11-01T11:00:00.000Z' });
});
it('adiciona procedimento real do catálogo com região e sem autoria escolhida pelo cliente', async () => {
  const s = setup(); await readyProcedure();
  expect(s.post).toHaveBeenCalledWith(`${base}/procedures`, { procedureId: 'cat1', toothOrRegion: '16', expectedUpdatedAt: '2026-11-01T11:00:00.000Z' });
  expect(screen.getByText('Dente / região: 16')).toBeDefined();
});
it('campos obrigatórios impedem procedimentos incompletos', async () => {
  const s = setup(); await userEvent.click(await screen.findByRole('button', { name: 'Adicionar procedimento', exact: true })); expect(s.post).not.toHaveBeenCalled();
  expect((screen.getByLabelText('Nome do procedimento') as HTMLInputElement).required).toBe(true); expect((screen.getByLabelText('Dente / região') as HTMLInputElement).required).toBe(true);
});
it('finaliza só após confirmação explícita e apresenta leitura sem botões de edição', async () => {
  const s = setup(); await readyProcedure(); await userEvent.click(screen.getByRole('button', { name: 'Finalizar registo', exact: true }));
  const dialog = screen.getByRole('dialog', { name: 'Finalizar registo clínico' }); expect(s.post.mock.calls.some(([url]) => url.endsWith('/finalize'))).toBe(false);
  expect(within(dialog).getByText(/Futuras correções/)).toBeDefined(); await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar finalização' }));
  await screen.findByRole('heading', { name: 'Registo finalizado' }); expect(screen.queryByLabelText('Notas clínicas')).toBeNull(); expect(screen.queryByRole('button', { name: 'Adicionar procedimento', exact: true })).toBeNull();
  expect(screen.getByText('Estado da consulta: Em atendimento')).toBeDefined();
});
it('rejeição de finalização não mostra sucesso nem registo finalizado', async () => {
  const s = setup(); await readyProcedure(); s.post.mockRejectedValue({ isAxiosError: true, response: { status: 409 } });
  await userEvent.click(screen.getByRole('button', { name: 'Finalizar registo', exact: true })); await userEvent.click(screen.getByRole('button', { name: 'Confirmar finalização' }));
  await screen.findByText(/Registo alterado, finalizado/); expect(screen.queryByRole('heading', { name: 'Registo finalizado' })).toBeNull(); expect(screen.getByLabelText('Notas clínicas')).toBeDefined();
});
it('rascunhos com notas não guardadas não podem ser finalizados', async () => {
  setup(); await readyProcedure(); fireEvent.change(screen.getByLabelText('Notas clínicas'), { target: { value: 'Alteração ainda local' } });
  expect((screen.getByRole('button', { name: 'Finalizar registo', exact: true }) as HTMLButtonElement).disabled).toBe(true);
});
it('aditamento é acrescentado mantendo o texto original visível', async () => {
  const s = setup({ record: { ...record(), finalizedAt: '2026-11-01T12:00:00.000Z' } });
  await userEvent.type(await screen.findByLabelText('Texto do aditamento'), 'Correção adicional'); await userEvent.click(screen.getByRole('button', { name: 'Acrescentar aditamento' }));
  await screen.findByText('Correção adicional'); expect(screen.getByText('Notas reais devolvidas pela API')).toBeDefined(); expect(s.post).toHaveBeenCalledWith(`${base}/addenda`, { content: 'Correção adicional' });
});
it('histórico usa ordem da API, paginação e aditamentos, sem campos de edição para paciente', async () => {
  const s = setup({ role: 'PATIENT' }); const appointment = { id: 'a1', startAt: '2026-11-01T11:00:00.000Z', endAt: '2026-11-01T12:00:00.000Z', status: 'COMPLETED' as const, patient: { id: 'p1', name: 'Paciente', birthDate: null, phone: null }, dentist: { name: 'Dra. Teste' } };
  s.history({ timeZone: 'America/Sao_Paulo', hasMore: true, items: [{ ...record(), id: 'new', finalizedAt: '2026-11-01T12:00:00.000Z', appointment, addenda: [{ id: 'ad1', content: 'Aditamento histórico', createdAt: '2026-11-02T12:00:00.000Z', author: { name: 'Dra. Teste' } }] }, { ...record(), id: 'old', finalizedAt: '2026-10-01T12:00:00.000Z', appointment: { ...appointment, startAt: '2026-10-01T11:00:00.000Z' } }] });
  await screen.findByText('Aditamento histórico'); const entries = screen.getAllByRole('article', { name: /Registo de/ }); expect(entries[0].getAttribute('aria-label')).toContain('01/11/2026'); expect(entries[1].getAttribute('aria-label')).toContain('01/10/2026');
  expect(screen.queryByLabelText('Notas clínicas')).toBeNull(); expect(screen.queryByLabelText('Texto do aditamento')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Seguinte' })); await waitFor(() => expect(s.get).toHaveBeenCalledWith('/clinical/history', expect.objectContaining({ params: { page: 2, pageSize: 10 } })));
  expect(s.get.mock.calls.every(([url]) => !url.includes('patientId='))).toBe(true);
});
it('nega acesso clínico visual à recepção e administração', async () => {
  for (const role of ['RECEPTIONIST', 'ADMIN'] as const) {
    const s = setup({ role }); await screen.findByRole('heading', { name: 'Olá, Pessoa Teste' }); expect(s.get.mock.calls.some(([url]) => url.startsWith('/clinical'))).toBe(false); cleanup();
  }
});
it('mostra erros de autorização e consulta inexistente sem inventar dados', async () => {
  setup({ error: 403 }); await screen.findByRole('alert'); expect(screen.getByText(/Não tem permissão/)).toBeDefined(); expect(screen.queryByLabelText('Notas clínicas')).toBeNull();
});
it('consulta cancelada não permite iniciar um novo rascunho', async () => {
  setup({ record: null, status: 'CANCELLED' }); await screen.findByText('Estado da consulta: Cancelado'); expect(screen.queryByRole('button', { name: 'Iniciar rascunho' })).toBeNull();
});
it('falha de rede e conflito preservam notas locais; recarregar exige confirmação', async () => {
  const s = setup(); await screen.findByLabelText('Notas clínicas'); fireEvent.change(screen.getByLabelText('Notas clínicas'), { target: { value: 'Não perder este texto' } });
  s.patch.mockRejectedValueOnce(new Error('offline')); await userEvent.click(screen.getByRole('button', { name: 'Guardar rascunho' })); await screen.findByText(/Não foi possível carregar ou guardar/);
  expect((screen.getByLabelText('Notas clínicas') as HTMLTextAreaElement).value).toBe('Não perder este texto');
  s.patch.mockRejectedValueOnce({ isAxiosError: true, response: { status: 409 } }); await userEvent.click(screen.getByRole('button', { name: 'Guardar rascunho' })); await screen.findByText(/As alterações locais não foram enviadas/);
  await userEvent.click(screen.getByRole('button', { name: 'Recarregar prontuário' })); await screen.findByRole('dialog', { name: 'Descartar alterações locais?' });
});
it('sessão expirada desmonta o prontuário e nenhum conteúdo é persistido no navegador', async () => {
  const stored = vi.spyOn(Storage.prototype, 'setItem'); setup(); await screen.findByLabelText('Notas clínicas');
  fireEvent.change(screen.getByLabelText('Notas clínicas'), { target: { value: 'Conteúdo sensível temporário' } });
  fireEvent(window, new Event('auth:unauthorized')); await screen.findByRole('button', { name: 'Entrar', exact: true });
  expect(screen.queryByLabelText('Notas clínicas')).toBeNull(); expect(stored).not.toHaveBeenCalled();
});
it('submissão pendente impede duplo envio e mantém o estado não finalizado', async () => {
  const s = setup(); await screen.findByLabelText('Notas clínicas');
  let finish!: (value: { data: { record: ClinicalRecord } }) => void;
  s.patch.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await userEvent.click(screen.getByRole('button', { name: 'Guardar rascunho' })); const button = screen.getByRole('button', { name: 'A guardar…' }) as HTMLButtonElement;
  expect(button.disabled).toBe(true); await userEvent.click(button); expect(s.patch).toHaveBeenCalledTimes(1);
  finish({ data: { record: record() } }); await screen.findByText('Rascunho guardado.');
});
