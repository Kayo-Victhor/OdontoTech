import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import { budgetError, budgetMoney, type BudgetOption, type BudgetSimulation } from '../services/budgets';
import { BudgetSelector } from '../components/BudgetSelector';
import { BudgetSummary } from '../components/BudgetSummary';

interface Item { procedure: BudgetOption; quantity: number }
export function BudgetSimulationPage() {
  const [patient, setPatient] = useState<BudgetOption | null>(null); const [procedure, setProcedure] = useState<BudgetOption | null>(null);
  const [quantity, setQuantity] = useState(1); const [items, setItems] = useState<Item[]>([]); const [installments, setInstallments] = useState(1);
  const [simulation, setSimulation] = useState<BudgetSimulation | null>(null); const [error, setError] = useState(''); const [pending, setPending] = useState(false);
  const request = useRef<AbortController | null>(null); const busy = useRef(false);
  useEffect(() => () => request.current?.abort(), []);
  function invalidate() { request.current?.abort(); busy.current = false; setPending(false); setSimulation(null); setError(''); }
  async function simulate() {
    if (busy.current) return;
    if (!patient || !items.length || items.some((item) => !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 100)) { setError('Selecione um paciente e pelo menos um procedimento, com quantidade inteira de 1 a 100.'); return; }
    const controller = new AbortController(); request.current?.abort(); request.current = controller; busy.current = true; setPending(true); setError(''); setSimulation(null);
    try {
      const { data } = await api.post<BudgetSimulation>('/budget-simulations/simulate', { patientId: patient.id, items: items.map((item) => ({ procedureId: item.procedure.id, quantity: item.quantity })), installments }, { signal: controller.signal });
      if (!controller.signal.aborted) setSimulation(data);
    } catch (failure) { if (!controller.signal.aborted) setError(budgetError(failure)); }
    finally { if (!controller.signal.aborted) { busy.current = false; setPending(false); } }
  }
  return <main className="agenda-page budget-page"><header className="admin-header budget-controls"><div><p className="brand-name">Odonto<span>Tech</span></p><h1>Simulação de orçamentos</h1></div><Link to="/dentista">Voltar à minha área</Link></header>
    <section className="budget-controls"><p>Estimativa sem juros e sem compromisso financeiro. Não há gravação de orçamento, pagamentos ou dívidas.</p>
      <div className="budget-input-columns"><section className="clinical-panel"><h2>Paciente autorizado</h2><BudgetSelector resource="patients" label="Paciente" selected={patient} onChange={(value) => { invalidate(); setPatient(value); }} /></section>
      <section className="clinical-panel"><h2>Adicionar procedimento</h2><form onSubmit={(event) => {
        event.preventDefault();
        if (!procedure || procedure.unitPrice === null || procedure.unitPrice === undefined) { setError('Selecione um procedimento com preço configurado no catálogo.'); return; }
        const previous = items.find((item) => item.procedure.id === procedure.id);
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100 || (previous?.quantity ?? 0) + quantity > 100 || (!previous && items.length >= 50)) { setError('Máximo de 50 procedimentos e quantidade de 1 a 100 por item.'); return; }
        invalidate(); setItems((current) => previous ? current.map((item) => item.procedure.id === procedure.id ? { ...item, quantity: item.quantity + quantity } : item) : [...current, { procedure, quantity }]); setProcedure(null); setQuantity(1);
      }}><BudgetSelector resource="procedures" label="Procedimento" selected={procedure} onChange={setProcedure} /><label className="field"><span>Quantidade a adicionar</span><span className="field-control"><input type="number" min={1} max={100} step={1} required value={quantity || ''} onChange={(event) => setQuantity(Number(event.target.value))} /></span></label><button className="submit-button" type="submit">Adicionar item</button></form></section></div>
      <section className="clinical-panel"><h2>Itens da simulação</h2>{items.length === 0 ? <p>Nenhum procedimento adicionado.</p> : <ul className="budget-items">{items.map((item) => <li key={item.procedure.id}><div><strong>{item.procedure.name}</strong>{item.procedure.description && <p className="clinical-text">{item.procedure.description}</p>}<p>Preço de referência: {budgetMoney(item.procedure.unitPrice!)}. Confirmado novamente ao calcular.</p></div><label className="field"><span>Quantidade de {item.procedure.name}</span><input type="number" min={1} max={100} step={1} required value={item.quantity || ''} onChange={(event) => { invalidate(); const value = Number(event.target.value); setItems((current) => current.map((row) => row.procedure.id === item.procedure.id ? { ...row, quantity: value } : row)); }} /></label><button className="text-button" onClick={() => { invalidate(); setItems((current) => current.filter((row) => row.procedure.id !== item.procedure.id)); }}>Remover {item.procedure.name}</button></li>)}</ul>}
      <label className="field"><span>Número de parcelas simuladas</span><select value={installments} onChange={(event) => { invalidate(); setInstallments(Number(event.target.value)); }}>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></label>
      <p className="field-hint">Os subtotais, o total e as opções de 1, 3, 6 e 12 parcelas são calculados pelo servidor, sem taxas.</p>
      <button className="submit-button" disabled={pending || !patient || !items.length} onClick={() => void simulate()}>{pending ? 'A calcular…' : 'Calcular estimativa'}</button>
      {error && <p role="alert" className="form-message--error">{error}</p>}{pending && <p role="status">A calcular valores no servidor…</p>}
      </section>
    </section>
    {simulation && <BudgetSummary simulation={simulation} />}
  </main>;
}
