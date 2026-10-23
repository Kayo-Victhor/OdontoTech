import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { DateTime } from 'luxon';
import { App } from '../src/App';
import { AuthProvider, type UserRole } from '../src/auth/AuthProvider';
import { api } from '../src/services/api';
import { agendaSlots, clinicInstant, type Appointment } from '../src/services/appointments';

afterEach(cleanup);
const config = { timeZone: 'America/Sao_Paulo', startHour: 8, endHour: 18, slotMinutes: 60 };
const date = DateTime.now().setZone(config.timeZone).toISODate()!;
const appointment: Appointment = { id: 'a1', patientId: 'p1', dentistId: 'd1', startAt: `${date}T08:00:00-03:00`, endAt: `${date}T09:00:00-03:00`, status: 'SCHEDULED', reason: 'Avaliação', cancellationReason: null, patient: { id: 'p1', name: 'Paciente Teste' }, dentist: { id: 'd1', name: 'Dentista Teste' } };
function setup(role: UserRole = 'ADMIN', initial: Appointment[] = [appointment]) {
  let data = initial;
  const get = vi.spyOn(api, 'get').mockImplementation((url, options) => {
    if (url === '/auth/me') return Promise.resolve({ data: { user: { id: role.toLowerCase(), name: 'Pessoa Teste', role } } });
    if (url === '/appointments/config') return Promise.resolve({ data: config });
    if (url === '/appointments/options') return Promise.resolve({ data: { items: options?.params?.kind === 'patients' ? [appointment.patient] : [appointment.dentist], hasMore: false } });
    if (url === '/appointments/a1') return Promise.resolve({ data: { appointment: data[0] } });
    if (url === '/appointments') return Promise.resolve({ data: { appointments: data } });
    return Promise.reject(new Error('Unexpected route'));
  });
  render(<MemoryRouter initialEntries={['/agenda']}><AuthProvider><App /></AuthProvider></MemoryRouter>);
  return { get, setData: (value: Appointment[]) => { data = value; } };
}
async function fillAppointment() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Novo agendamento' }));
  const dialog = await screen.findByRole('dialog', { name: 'Novo agendamento' });
  await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Paciente Teste' })).toBeDefined());
  await user.selectOptions(within(dialog).getByLabelText('Paciente', { exact: true }), 'p1');
  await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Dentista Teste' })).toBeDefined());
  await user.selectOptions(within(dialog).getByLabelText('Dentista', { exact: true }), 'd1');
  return { user, dialog };
}
it('carrega consultas reais da API, apresenta estados textuais e consulta detalhes', async () => {
  const s = setup();
  await screen.findByRole('article', { name: 'Consulta de Paciente Teste' });
  expect(s.get).toHaveBeenCalledWith('/appointments', expect.objectContaining({ params: { date } }));
  expect(screen.getByText('Agendado')).toBeDefined();
  await userEvent.click(screen.getByRole('button', { name: 'Consultar', exact: true }));
  const dialog = await screen.findByRole('dialog', { name: 'Detalhes da consulta' });
  await within(dialog).findByText('Avaliação');
  expect(s.get).toHaveBeenCalledWith('/appointments/a1', expect.anything());
});
it('mostra carregamento pendente sem confundir com uma agenda vazia', async () => {
  const s = setup();
  const initial = s.get.getMockImplementation()!;
  let finish!: (value: { data: { appointments: Appointment[] } }) => void;
  s.get.mockImplementation((url, options) => url === '/appointments'
    ? new Promise((resolve) => { finish = resolve; })
    : initial(url, options));
  await screen.findByText('A carregar consultas…');
  expect(screen.queryByText('Nenhuma consulta neste dia.')).toBeNull();
  finish({ data: { appointments: [appointment] } });
  await screen.findByRole('article', { name: 'Consulta de Paciente Teste' });
});
it('impede submissões repetidas enquanto o agendamento está a guardar', async () => {
  setup();
  let finish!: (value: { data: { appointment: Appointment } }) => void;
  const post = vi.spyOn(api, 'post').mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const { user, dialog } = await fillAppointment();
  await user.click(within(dialog).getByRole('button', { name: 'Guardar consulta' }));
  const pending = within(dialog).getByRole('button', { name: 'A guardar…' }) as HTMLButtonElement;
  expect(pending.disabled).toBe(true);
  await user.click(pending);
  expect(post).toHaveBeenCalledTimes(1);
  finish({ data: { appointment } });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
it('filtros de data e dentista são enviados sem patientId arbitrário', async () => {
  const s = setup(); const field = await screen.findByLabelText('Data da agenda');
  fireEvent.change(field, { target: { value: '2026-12-02' } });
  await waitFor(() => expect(s.get).toHaveBeenCalledWith('/appointments', expect.objectContaining({ params: { date: '2026-12-02' } })));
  await waitFor(() => expect(screen.getByRole('option', { name: 'Dentista Teste' })).toBeDefined());
  await userEvent.selectOptions(screen.getByLabelText('Profissional', { exact: true }), 'd1');
  await waitFor(() => expect(s.get).toHaveBeenCalledWith('/appointments', expect.objectContaining({ params: { date: '2026-12-02', dentistId: 'd1' } })));
});
it('cria agendamento com IDs da API, timestamps UTC e atualiza lista', async () => {
  const s = setup('RECEPTIONIST', []);
  const post = vi.spyOn(api, 'post').mockImplementation(async () => { s.setData([appointment]); return { data: { appointment } }; });
  const { user, dialog } = await fillAppointment();
  await user.click(within(dialog).getByRole('button', { name: 'Guardar consulta' }));
  await screen.findByRole('article', { name: 'Consulta de Paciente Teste' });
  expect(post).toHaveBeenCalledWith('/appointments', { patientId: 'p1', dentistId: 'd1', startAt: `${date}T11:00:00.000Z`, endAt: `${date}T12:00:00.000Z`, reason: null });
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('campos obrigatórios impedem envio e final anterior ao início mostra erro', async () => {
  setup(); const post = vi.spyOn(api, 'post');
  await userEvent.click(await screen.findByRole('button', { name: 'Novo agendamento' }));
  const dialog = screen.getByRole('dialog', { name: 'Novo agendamento' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar consulta' }));
  expect(post).not.toHaveBeenCalled();
  await userEvent.selectOptions(await within(dialog).findByLabelText('Paciente', { exact: true }), 'p1');
  await userEvent.selectOptions(within(dialog).getByLabelText('Dentista', { exact: true }), 'd1');
  fireEvent.change(within(dialog).getByLabelText('Hora de término'), { target: { value: '07:00' } });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar consulta' }));
  expect((await within(dialog).findByRole('alert')).textContent).toContain('posterior'); expect(post).not.toHaveBeenCalled();
});
it('conflito da API mostra mensagem e atualiza agenda sem fechar o formulário', async () => {
  const s = setup(); vi.spyOn(api, 'post').mockRejectedValue({ isAxiosError: true, response: { status: 409 } });
  const { user, dialog } = await fillAppointment(); const count = s.get.mock.calls.filter(([url]) => url === '/appointments').length;
  await user.click(within(dialog).getByRole('button', { name: 'Guardar consulta' }));
  expect((await within(dialog).findByRole('alert')).textContent).toContain('Conflito');
  await waitFor(() => expect(s.get.mock.calls.filter(([url]) => url === '/appointments').length).toBeGreaterThan(count));
});
it('edição envia só campos operacionais e atualiza a lista', async () => {
  const s = setup(); const patch = vi.spyOn(api, 'patch').mockImplementation(async () => { s.setData([{ ...appointment, reason: 'Revisão' }]); return {}; });
  await userEvent.click(await screen.findByRole('button', { name: 'Editar', exact: true }));
  const dialog = screen.getByRole('dialog', { name: 'Editar consulta' });
  fireEvent.change(within(dialog).getByLabelText('Motivo (opcional)'), { target: { value: 'Revisão' } });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar consulta' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(patch).toHaveBeenCalledWith('/appointments/a1', expect.objectContaining({ reason: 'Revisão' }));
});
it('cancelamento exige confirmação e preserva o cartão com estado Cancelado', async () => {
  const s = setup(); const patch = vi.spyOn(api, 'patch').mockImplementation(async () => { s.setData([{ ...appointment, status: 'CANCELLED' }]); return {}; });
  await userEvent.click(await screen.findByRole('button', { name: 'Cancelar', exact: true }));
  expect(patch).not.toHaveBeenCalled();
  const dialog = screen.getByRole('dialog', { name: 'Cancelar consulta' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar cancelamento' }));
  await screen.findByText('Cancelado'); expect(patch).toHaveBeenCalledWith('/appointments/a1/status', { status: 'CANCELLED' });
});
it('agenda vazia é explícita, sem inventar compromissos', async () => {
  setup('ADMIN', []); await screen.findByText('Nenhuma consulta neste dia.');
  expect(screen.queryByRole('article')).toBeNull(); expect(screen.queryByText('Livre')).toBeNull();
});
it('falha da API mostra erro e não uma agenda vazia confirmada', async () => {
  const s = setup();
  s.get.mockImplementation((url) => url === '/auth/me' ? Promise.resolve({ data: { user: { id: 'patient', name: 'Paciente', role: 'PATIENT' } } }) : url === '/appointments/config' ? Promise.resolve({ data: config }) : Promise.reject(new Error('offline')));
  expect((await screen.findAllByRole('alert')).every((alert) => alert.textContent?.includes('Não foi possível'))).toBe(true);
  expect(screen.queryByText('Nenhuma consulta neste dia.')).toBeNull();
});
it('paciente só consulta próprios dados e não recebe ações nem opções globais', async () => {
  const s = setup('PATIENT'); await screen.findByRole('article');
  expect(screen.queryByRole('button', { name: 'Novo agendamento' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Cancelar', exact: true })).toBeNull();
  expect(screen.queryByLabelText('Profissional', { exact: true })).toBeNull();
  expect(s.get).toHaveBeenCalledWith('/appointments', expect.objectContaining({ params: { date } }));
  expect(s.get.mock.calls.some(([url]) => url === '/appointments/options')).toBe(false);
});
it('dentista só vê ações de início/conclusão; criação não está disponível', async () => {
  setup('DENTIST', [{ ...appointment, status: 'WAITING' }]);
  await screen.findByRole('button', { name: 'Marcar: Em atendimento' });
  expect(screen.queryByRole('button', { name: 'Cancelar', exact: true })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Editar', exact: true })).toBeNull();
});
it('intervalo parcialmente ocupado nunca é Livre e horários fora da grelha continuam visíveis', () => {
  const items = [{ ...appointment, startAt: `${date}T07:30:00-03:00`, endAt: `${date}T08:30:00-03:00` }];
  const grid = agendaSlots(date, config, items); expect(grid.slots[0].occupied).toBe(true); expect(grid.outside.length).toBe(1);
  expect(agendaSlots(date, config, [{ ...items[0], status: 'CANCELLED' }]).slots[0].occupied).toBe(false);
});
it('conversão de horários respeita fuso e rejeita horas inexistentes/ambíguas', () => {
  expect(clinicInstant('2026-11-01', '08:00', config.timeZone)).toBe('2026-11-01T11:00:00.000Z');
  expect(() => clinicInstant('2026-03-08', '02:30', 'America/New_York')).toThrow();
  expect(() => clinicInstant('2026-11-01', '01:30', 'America/New_York')).toThrow();
});
