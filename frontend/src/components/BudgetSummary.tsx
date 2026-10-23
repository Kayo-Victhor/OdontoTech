import { DateTime } from 'luxon';
import { budgetMoney, type BudgetSimulation } from '../services/budgets';

export function BudgetSummary({ simulation }: { simulation: BudgetSimulation }) {
  return <section className="budget-summary clinical-panel" aria-label="Resumo da estimativa">
    <header><p className="brand-name">{simulation.clinicName}</p><h2>Simulação de orçamento odontológico</h2></header>
    <p>Paciente: <strong>{simulation.patient.name}</strong> · Identificação: {simulation.patient.id}</p>
    <p>Profissional: {simulation.dentist.name} · CRO {simulation.dentist.croNumber}/{simulation.dentist.croState}</p>
    <p>Data: {DateTime.fromISO(simulation.createdAt).setZone(simulation.timeZone).toFormat('dd/MM/yyyy HH:mm')} · {simulation.timeZone}</p>
    <div className="users-table-container"><table className="users-table"><caption className="sr-only">Procedimentos e valores estimados</caption><thead><tr><th scope="col">Procedimento</th><th scope="col">Quantidade</th><th scope="col">Preço unitário</th><th scope="col">Subtotal</th></tr></thead><tbody>{simulation.items.map((item) => <tr key={item.procedureId}><td>{item.name}{item.description && <span className="clinical-text">{item.description}</span>}</td><td>{item.quantity}</td><td>{budgetMoney(item.unitPrice)}</td><td>{budgetMoney(item.subtotal)}</td></tr>)}</tbody></table></div>
    <p className="budget-total">Total estimado: <strong>{budgetMoney(simulation.total)}</strong></p>
    <h3>Comparação de parcelamento — sem juros</h3><p>Opção selecionada: {simulation.selectedInstallments} parcela(s). A última parcela absorve o ajuste de centavos.</p>
    <ul className="budget-plans">{simulation.plans.map((plan) => <li key={plan.count}><strong>{plan.count} parcela(s){plan.count === simulation.selectedInstallments ? ' — selecionada' : ''}</strong><p>{plan.count === 1 ? `Parcela única de ${budgetMoney(plan.lastAmount)}` : `${plan.count - 1} de ${budgetMoney(plan.regularAmount)} e última de ${budgetMoney(plan.lastAmount)}`}</p><p>Ajuste na última: {budgetMoney(plan.adjustment)}</p></li>)}</ul>
    <p className="budget-disclaimer">{simulation.notice}</p><p>Simulação não guardada. Não gera parcelas devidas, vencimentos, saldo ou dívida.</p>
    <button className="submit-button budget-print-button" type="button" onClick={() => window.print()}>Imprimir estimativa</button>
  </section>;
}
