import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { clinicalError } from '../services/clinical';

export function ClinicalProcedureForm({ pending, onAdd }: { pending: boolean; onAdd: (data: { procedureId?: string; procedureName?: string; toothOrRegion: string; description?: string; notes?: string }) => Promise<boolean> }) {
  const [search, setSearch] = useState(''); const [page, setPage] = useState(1); const [selection, setSelection] = useState('');
  const [catalog, setCatalog] = useState<{ items: { id: string; name: string }[]; hasMore: boolean } | null>(null);
  const [error, setError] = useState(''); const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setCatalog(null); setError('');
    api.get('/clinical/catalog', { params: { search, page, pageSize: 20 }, signal: controller.signal }).then(({ data }) => { if (!controller.signal.aborted) setCatalog(data); })
      .catch((failure) => { if (!controller.signal.aborted) setError(clinicalError(failure)); });
    return () => controller.abort();
  }, [search, page, retry]);
  return <section className="clinical-panel"><h3>Adicionar procedimento</h3>
    <form onSubmit={async (event) => {
      event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
      const value = (name: string) => String(data.get(name) || '').trim();
      const saved = await onAdd({ ...(selection ? { procedureId: selection } : { procedureName: value('procedureName') }), toothOrRegion: value('toothOrRegion'), ...(value('description') ? { description: value('description') } : {}), ...(value('procedureNotes') ? { notes: value('procedureNotes') } : {}) });
      if (saved) { form.reset(); setSelection(''); }
    }}><fieldset disabled={pending} className="account-fields">
      <label className="field"><span>Pesquisar catálogo</span><span className="field-control"><input value={search} maxLength={100} onChange={(e) => { setSearch(e.target.value); setPage(1); setSelection(''); }} /></span></label>
      {!catalog && !error && <p role="status">A carregar catálogo…</p>}
      {error && <><p role="alert">{error}</p><button type="button" className="text-button" onClick={() => setRetry((n) => n + 1)}>Recarregar catálogo</button></>}
      <label className="field"><span>Procedimento do catálogo (opcional)</span><select value={selection} onChange={(e) => setSelection(e.target.value)}><option value="">Registo manual</option>{catalog?.items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {catalog && catalog.items.length === 0 && <p className="field-hint">Sem procedimentos no catálogo para esta pesquisa. Pode registar o procedimento manualmente.</p>}
      <div className="pagination"><button type="button" disabled={page === 1 || !catalog} onClick={() => { setPage((p) => p - 1); setSelection(''); }}>Página anterior do catálogo</button><button type="button" disabled={!catalog?.hasMore} onClick={() => { setPage((p) => p + 1); setSelection(''); }}>Mais procedimentos</button></div>
      {!selection && <label className="field"><span>Nome do procedimento</span><span className="field-control"><input name="procedureName" required maxLength={191} /></span></label>}
      <label className="field"><span>Dente / região</span><span className="field-control"><input name="toothOrRegion" required maxLength={80} placeholder="Ex.: 16, arcada superior" /></span></label>
      <label className="field"><span>Descrição do procedimento realizado (opcional)</span><textarea name="description" maxLength={2000} /></label>
      <label className="field"><span>Notas do procedimento (opcional)</span><textarea name="procedureNotes" maxLength={2000} /></label>
      <button className="submit-button" disabled={pending}>Adicionar procedimento</button>
    </fieldset></form>
  </section>;
}
