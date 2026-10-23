import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../src/App';
import { AuthProvider, type UserRole } from '../src/auth/AuthProvider';
import { api } from '../src/services/api';
import { budgetMoney, type BudgetSimulation } from '../src/services/budgets';

afterEach(cleanup);
const simulation: BudgetSimulation = { clinicName: 'OdontoTech', createdAt: '2026-11-01T11:00:00.000Z', timeZone: 'America/Sao_Paulo', patient: { id: 'p1', name: 'Paciente autorizado' }, dentist: { id: 'd1', name: 'Dentista da API', croNumber: '12345', croState: 'SP' }, currency: 'BRL', selectedInstallments: 3, total: '100.00', persisted: false,
  items: [{ procedureId: 'proc1', name: 'Restauração da API', description: 'Descrição real do catálogo', quantity: 2, unitPrice: '50.00', subtotal: '100.00' }],
  plans: [{ count: 1, regularAmount: '100.00', lastAmount: '100.00', adjustment: '0.00', amounts: ['100.00'] }, { count: 3, regularAmount: '33.33', lastAmount: '33.34', adjustment: '0.01', amounts: ['33.33', '33.33', '33.34'] }, { count: 6, regularAmount: '16.66', lastAmount: '16.70', adjustment: '0.04', amounts: ['16.66', '16.66', '16.66', '16.66', '16.66', '16.70'] }, { count: 12, regularAmount: '8.33', lastAmount: '8.37', adjustment: '0.04', amounts: [...Array<string>(11).fill('8.33'), '8.37'] }], notice: 'Estimativa de tratamento, sem juros. Não constitui pagamento, recibo, fatura ou compromisso financeiro.' };
function setup(role: UserRole = 'DENTIST') {
  const get = vi.spyOn(api, 'get').mockImplementation((url) => {
    if (url === '/auth/me') return Promise.resolve({ data: { user: { id: 'dentist', name: 'Conta Teste', role } } });
    if (url === '/budget-simulations/patients') return Promise.resolve({ data: { items: [simulation.patient], hasMore: false } });
    if (url === '/budget-simulations/procedures') return Promise.resolve({ data: { items: [{ id: 'proc1', name: 'Restauração da API', description: 'Descrição real do catálogo', unitPrice: '50.00' }, { id: 'unpriced', name: 'Procedimento sem preço', unitPrice: null }], hasMore: false } });
    return Promise.reject(new Error('Unexpected route'));
  });
  const post = vi.spyOn(api, 'post').mockResolvedValue({ data: simulation });
  render(<MemoryRouter initialEntries={['/dentista/orcamentos']}><AuthProvider><App /></AuthProvider></MemoryRouter>);
  return { get, post };
}
async function addItem() {
  await waitFor(() => expect(screen.getByRole('option', { name: 'Paciente autorizado' })).toBeDefined());
  await userEvent.selectOptions(screen.getByLabelText('Paciente', { exact: true }), 'p1');
  await waitFor(() => expect(screen.getByRole('option', { name: 'Restauração da API — R$ 50,00' })).toBeDefined());
  await userEvent.selectOptions(screen.getByLabelText('Procedimento', { exact: true }), 'proc1');
  fireEvent.change(screen.getByLabelText('Quantidade a adicionar'), { target: { value: '2' } });
  await userEvent.click(screen.getByRole('button', { name: 'Adicionar item' }));
}
async function calculate() { await userEvent.selectOptions(screen.getByLabelText('Número de parcelas simuladas'), '3'); await userEvent.click(screen.getByRole('button', { name: 'Calcular estimativa' })); return screen.findByRole('region', { name: 'Resumo da estimativa' }); }
it('carrega pacientes e procedimentos reais e permite adicionar e remover itens', async () => {
  const s = setup(); await addItem(); expect(s.get).toHaveBeenCalledWith('/budget-simulations/patients', expect.anything());
  expect(screen.getByLabelText('Quantidade de Restauração da API')).toBeDefined(); expect(screen.getByText('Descrição real do catálogo')).toBeDefined();
  await userEvent.click(screen.getByRole('button', { name: 'Remover Restauração da API' })); expect(screen.getByText('Nenhum procedimento adicionado.')).toBeDefined(); expect(s.post).not.toHaveBeenCalled();
});
it('envia apenas IDs, quantidades e parcelas, e mostra totais calculados pelo backend', async () => {
  const s = setup(); await addItem(); const summary = await calculate();
  expect(s.post).toHaveBeenCalledWith('/budget-simulations/simulate', { patientId: 'p1', items: [{ procedureId: 'proc1', quantity: 2 }], installments: 3 }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(within(summary).getByText('Total estimado:').textContent).toContain('R$ 100,00');
  expect(within(summary).getByText('2 de R$ 33,33 e última de R$ 33,34')).toBeDefined();
  expect(within(summary).getByText(/CRO 12345\/SP/)).toBeDefined(); expect(within(summary).getByText(/01\/11\/2026 08:00/)).toBeDefined();
  expect(within(summary).getByText(/Não constitui pagamento/)).toBeDefined(); expect(within(summary).getByText(/Simulação não guardada/)).toBeDefined();
});
it('compara opções de 1, 3, 6 e 12 parcelas sem juros ou vencimentos', async () => {
  setup(); await addItem(); const summary = await calculate();
  for (const text of ['1 parcela(s)', '3 parcela(s) — selecionada', '6 parcela(s)', '12 parcela(s)']) expect(within(summary).getByText(text)).toBeDefined();
  expect(within(summary).getByText('Ajuste na última: R$ 0,01')).toBeDefined();
});
it('seleção obrigatória e quantidades inválidas impedem pedidos', async () => {
  const s = setup(); await screen.findByLabelText('Paciente', { exact: true });
  expect((screen.getByRole('button', { name: 'Calcular estimativa' }) as HTMLButtonElement).disabled).toBe(true);
  await userEvent.click(screen.getByRole('button', { name: 'Adicionar item' })); await screen.findByRole('alert'); expect(s.post).not.toHaveBeenCalled();
  await addItem(); fireEvent.change(screen.getByLabelText('Quantidade de Restauração da API'), { target: { value: '0' } });
  await userEvent.click(screen.getByRole('button', { name: 'Calcular estimativa' })); await screen.findByRole('alert'); expect(s.post).not.toHaveBeenCalled();
});
it('catálogo sem preço é explícito e não permite selecionar o procedimento', async () => {
  setup(); const option = await screen.findByRole('option', { name: 'Procedimento sem preço — Sem preço configurado' }); expect((option as HTMLOptionElement).disabled).toBe(true);
  expect(screen.getByText(/Nenhum preço é presumido como zero/)).toBeDefined();
});
it('alterar itens invalida resumo e impede imprimir um cálculo desatualizado', async () => {
  setup(); await addItem(); await calculate();
  fireEvent.change(screen.getByLabelText('Quantidade de Restauração da API'), { target: { value: '3' } });
  expect(screen.queryByRole('region', { name: 'Resumo da estimativa' })).toBeNull(); expect(screen.queryByRole('button', { name: 'Imprimir estimativa' })).toBeNull();
});
it('mudar parcelas ou paciente invalida a estimativa anterior', async () => {
  setup(); await addItem(); await calculate(); await userEvent.selectOptions(screen.getByLabelText('Número de parcelas simuladas'), '6'); expect(screen.queryByRole('region', { name: 'Resumo da estimativa' })).toBeNull();
  await calculate(); await userEvent.selectOptions(screen.getByLabelText('Paciente', { exact: true }), ''); expect(screen.queryByRole('region', { name: 'Resumo da estimativa' })).toBeNull();
});
it('imprime pelo navegador sem criar pedido ou obrigação financeira', async () => {
  const print = vi.spyOn(window, 'print').mockImplementation(() => {}); const s = setup(); await addItem(); await calculate();
  await userEvent.click(screen.getByRole('button', { name: 'Imprimir estimativa' })); expect(print).toHaveBeenCalledOnce(); expect(s.post).toHaveBeenCalledTimes(1);
});
it.each(['ADMIN', 'RECEPTIONIST', 'PATIENT'] as const)('%s não acede à simulação', async (role) => {
  const s = setup(role); await screen.findByText('Olá, Conta Teste'); expect(s.get.mock.calls.some(([url]) => url.startsWith('/budget-simulations'))).toBe(false);
});
it('erro da API não mostra orçamento fictício nem resumo para impressão', async () => {
  const s = setup(); s.post.mockRejectedValue({ isAxiosError: true, response: { status: 409 } }); await addItem(); await calculateWithoutResult();
  expect((await screen.findByRole('alert')).textContent).toContain('sem preço configurado'); expect(screen.queryByRole('region', { name: 'Resumo da estimativa' })).toBeNull();
});
async function calculateWithoutResult() { await userEvent.click(screen.getByRole('button', { name: 'Calcular estimativa' })); }
it('bloqueia repetição pendente e ignora resposta antiga se os itens forem alterados', async () => {
  const s = setup(); let finish!: (value: { data: BudgetSimulation }) => void; s.post.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await addItem(); await calculateWithoutResult(); const button = screen.getByRole('button', { name: 'A calcular…' }) as HTMLButtonElement; expect(button.disabled).toBe(true); await userEvent.click(button); expect(s.post).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText('Quantidade de Restauração da API'), { target: { value: '3' } }); finish({ data: simulation });
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull()); expect(screen.queryByRole('region', { name: 'Resumo da estimativa' })).toBeNull();
});
it('resumo e escolhas não são persistidos em armazenamento do navegador', async () => {
  const stored = vi.spyOn(Storage.prototype, 'setItem'); setup(); await addItem(); await calculate(); expect(stored).not.toHaveBeenCalled();
});
it('novo cálculo mostra o preço atualizado pela API mesmo com seleção anterior em memória', async () => {
  const s = setup(); await addItem(); await calculate();
  s.post.mockResolvedValueOnce({ data: { ...simulation, total: '120.00', items: simulation.items.map((item) => ({ ...item, unitPrice: '60.00', subtotal: '120.00' })) } });
  await userEvent.click(screen.getByRole('button', { name: 'Calcular estimativa' }));
  const summary = await screen.findByRole('region', { name: 'Resumo da estimativa' }); expect(within(summary).getByText('Total estimado:').textContent).toContain('R$ 120,00'); expect(within(summary).getByText('R$ 60,00')).toBeDefined();
});
it('formatação monetária não efetua cálculos binários', () => { expect(budgetMoney('1234567.89')).toBe('R$ 1.234.567,89'); expect(budgetMoney('0.01')).toBe('R$ 0,01'); });
