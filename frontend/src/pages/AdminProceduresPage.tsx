import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { api } from '../services/api';
import { budgetMoney } from '../services/budgets';
import { procedureError, type CatalogProcedure, type ProcedureInput } from '../services/procedures';
import { ProcedureForm } from '../components/ProcedureForm';
import { AgendaDialog } from '../components/AgendaDialog';

export function AdminProceduresPage() {
  const [list, setList] = useState<{ items: CatalogProcedure[]; hasMore: boolean } | null>(null); const [search, setSearch] = useState(''); const [page, setPage] = useState(1); const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState<CatalogProcedure | null>(null); const [formRevision, setFormRevision] = useState(0);
  const [error, setError] = useState(''); const [loadError, setLoadError] = useState(''); const [success, setSuccess] = useState(''); const [forbidden, setForbidden] = useState(false); const [pending, setPending] = useState(false); const busy = useRef(false);
  const [confirmation, setConfirmation] = useState<{ procedure: CatalogProcedure; input: Partial<ProcedureInput> } | null>(null);
  useEffect(() => {
    const controller = new AbortController(); setList(null); setLoadError('');
    api.get<{ items: CatalogProcedure[]; hasMore: boolean }>('/admin/procedures', { params: { search, page, pageSize: 10 }, signal: controller.signal }).then(({ data }) => { if (!controller.signal.aborted) setList(data); }).catch((failure) => {
      if (!controller.signal.aborted) { setLoadError(procedureError(failure)); if (axios.isAxiosError(failure) && failure.response?.status === 403) setForbidden(true); }
    }); return () => controller.abort();
  }, [search, page, revision]);
  async function save(input: Partial<ProcedureInput>, procedure: CatalogProcedure | null) {
    if (busy.current || forbidden) return;
    busy.current = true; setPending(true); setError(''); setSuccess('');
    try {
      if (procedure) await api.patch(`/admin/procedures/${procedure.id}`, input); else await api.post('/admin/procedures', input);
      setSuccess(procedure ? 'Procedimento atualizado.' : 'Procedimento cadastrado.'); setEditing(null); setConfirmation(null); setFormRevision((n) => n + 1); setRevision((n) => n + 1);
    } catch (failure) { setError(procedureError(failure)); if (axios.isAxiosError(failure) && failure.response?.status === 403) setForbidden(true); setConfirmation(null); }
    finally { busy.current = false; setPending(false); }
  }
  return <main className="admin-page catalog-page"><header className="admin-header"><div><p className="brand-name">Odonto<span>Tech</span></p><h1>Catálogo de procedimentos</h1></div><Link to="/admin">Voltar à minha área</Link></header>
    {forbidden ? <p role="alert">Apenas administradores podem gerir o catálogo.</p> : <>
      {error && <p role="alert" className="form-message--error">{error}</p>}{success && <p role="status">{success}</p>}
      <p>Os preços são guardados no MySQL e usados em novas simulações. Desativar retira o procedimento da seleção, sem apagar o histórico.</p>
      <div className="admin-columns"><section aria-label="Formulário do procedimento"><ProcedureForm key={`${editing?.id ?? 'new'}-${formRevision}`} procedure={editing} pending={pending} onCancel={() => { setEditing(null); setError(''); }} onError={setError} onSave={(input) => { if (editing?.isActive && !input.isActive) setConfirmation({ procedure: editing, input }); else void save(input, editing); }} /></section>
      <section className="users-section" aria-label="Lista de procedimentos"><h2>Procedimentos registados</h2>
        <label className="field"><span>Pesquisar procedimentos</span><span className="field-control"><input type="search" value={search} maxLength={80} onChange={(e) => { setSearch(e.target.value); setPage(1); }} /></span></label>
        {loadError ? <><p role="alert">{loadError}</p><button className="text-button" onClick={() => setRevision((n) => n + 1)}>Tentar carregar catálogo novamente</button></> : !list ? <p role="status">A carregar catálogo…</p> : <>
          {list.items.length === 0 && <p>Nenhum procedimento encontrado.</p>}
          <div className="users-table-container"><table className="users-table"><caption className="sr-only">Catálogo completo, incluindo desativados e sem preço</caption><thead><tr><th scope="col">Procedimento</th><th scope="col">Preço</th><th scope="col">Duração</th><th scope="col">Disponibilidade</th><th scope="col">Ações</th></tr></thead><tbody>{list.items.map((item) => <tr key={item.id}><td>{item.name}{item.description && <span className="clinical-text">{item.description}</span>}</td><td>{item.defaultPrice === null ? <span className="catalog-unpriced">Não configurado</span> : budgetMoney(item.defaultPrice)}</td><td>{item.estimatedDurationMinutes === null ? 'Não informada' : `${item.estimatedDurationMinutes} min`}</td><td>{item.isActive ? 'Ativo' : 'Desativado'}</td><td><div className="catalog-actions"><button className="text-button" aria-label={`Editar ${item.name}`} disabled={pending} onClick={() => { setEditing(item); setError(''); setSuccess(''); }}>Editar</button><button className="text-button" aria-label={`${item.isActive ? 'Desativar' : 'Ativar'} ${item.name}`} disabled={pending} onClick={() => { if (item.isActive) setConfirmation({ procedure: item, input: { isActive: false } }); else void save({ isActive: true }, item); }}>{item.isActive ? 'Desativar' : 'Ativar'}</button></div></td></tr>)}</tbody></table></div>
        </>}
        <nav className="pagination" aria-label="Paginação do catálogo"><button disabled={page === 1 || !list || pending} onClick={() => setPage((n) => n - 1)}>Anterior</button><span>Página {page}</span><button disabled={!list?.hasMore || pending} onClick={() => setPage((n) => n + 1)}>Seguinte</button></nav>
      </section></div>
    </>}
    {confirmation && !forbidden && <AgendaDialog title="Desativar procedimento?" pending={pending} onClose={() => setConfirmation(null)}><p>Desativar {confirmation.procedure.name}? O item deixará de estar disponível para novas simulações e seleções clínicas. Os registos históricos serão preservados.</p><button className="submit-button" disabled={pending} onClick={() => void save(confirmation.input, confirmation.procedure)}>Confirmar desativação</button></AgendaDialog>}
  </main>;
}
