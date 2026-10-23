import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { budgetError, budgetMoney, type BudgetOption } from '../services/budgets';

export function BudgetSelector({ resource, label, selected, onChange, disabled }: { resource: 'patients' | 'procedures'; label: string; selected: BudgetOption | null; onChange: (value: BudgetOption | null) => void; disabled?: boolean }) {
  const [search, setSearch] = useState(''); const [page, setPage] = useState(1); const [revision, setRevision] = useState(0);
  const [items, setItems] = useState<BudgetOption[]>([]); const [hasMore, setHasMore] = useState(false); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(''); if (page === 1) setItems([]);
    api.get<{ items: BudgetOption[]; hasMore: boolean }>(`/budget-simulations/${resource}`, { params: { search, page, pageSize: 20 }, signal: controller.signal }).then(({ data }) => {
      if (!controller.signal.aborted) { setItems((previous) => [...new Map([...(page === 1 ? [] : previous), ...data.items].map((item) => [item.id, item])).values()]); setHasMore(data.hasMore); }
    }).catch((failure) => { if (!controller.signal.aborted) setError(budgetError(failure)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [resource, search, page, revision]);
  const options = selected && !items.some((item) => item.id === selected.id) ? [selected, ...items] : items;
  return <div className="profile-picker">
    <label className="field"><span>Pesquisar {label.toLowerCase()}</span><span className="field-control"><input type="search" value={search} disabled={disabled} maxLength={80} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></span></label>
    <label className="field"><span>{label}</span><select value={selected?.id ?? ''} disabled={disabled} onChange={(event) => onChange(options.find((item) => item.id === event.target.value) ?? null)}><option value="">Selecione</option>{options.map((item) => <option key={item.id} value={item.id} disabled={resource === 'procedures' && item.unitPrice === null}>{item.name}{resource === 'procedures' ? ` — ${item.unitPrice === null || item.unitPrice === undefined ? 'Sem preço configurado' : budgetMoney(item.unitPrice)}` : ''}</option>)}</select></label>
    {selected?.description && <p className="clinical-text">{selected.description}</p>}
    {loading && <p role="status">A carregar {label.toLowerCase()}…</p>}
    {error && <><p role="alert">{error}</p><button className="text-button" type="button" onClick={() => setRevision((n) => n + 1)}>Repetir pesquisa de {label.toLowerCase()}</button></>}
    {!loading && !error && items.length === 0 && <p>Nenhum resultado para {label.toLowerCase()}.{resource === 'patients' && ' São apresentados apenas pacientes ativos ligados às suas consultas não canceladas.'}</p>}
    {resource === 'procedures' && !loading && items.some((item) => item.unitPrice === null) && <p className="field-hint">Procedimentos sem preço precisam de configuração pela administração no catálogo. Nenhum preço é presumido como zero.</p>}
    {hasMore && !loading && <button className="text-button" type="button" disabled={disabled} onClick={() => setPage((n) => n + 1)}>Carregar mais {label.toLowerCase()}</button>}
  </div>;
}
