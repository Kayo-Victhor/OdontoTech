import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { clinicalDate, clinicalError, type ClinicalHistory as HistoryData, type ClinicalRecord } from '../services/clinical';

export function ClinicalContents({ record, timeZone, showNotes = true }: { record: ClinicalRecord; timeZone: string; showNotes?: boolean }) {
  return <>
    {showNotes && <p className="clinical-text">{record.notes || 'Sem notas clínicas.'}</p>}
    <ul className="clinical-procedures">{record.procedures.map((procedure) => <li key={procedure.id}><strong>{procedure.procedureNameSnapshot}</strong><p>Dente / região: {procedure.toothOrRegion}</p>{procedure.descriptionSnapshot && <p className="clinical-text">{procedure.descriptionSnapshot}</p>}{procedure.notes && <p className="clinical-text">{procedure.notes}</p>}</li>)}</ul>
    {record.addenda.length > 0 && <section aria-label="Aditamentos"><h3>Aditamentos</h3>{record.addenda.map((item) => <article key={item.id} className="clinical-addendum"><p>{item.author.name} · {clinicalDate(item.createdAt, timeZone)}</p><p className="clinical-text">{item.content}</p></article>)}</section>}
  </>;
}
export function ClinicalHistory({ endpoint, revision = 0 }: { endpoint: string; revision?: number }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<HistoryData | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setData(null); setError('');
    api.get<HistoryData>(endpoint, { params: { page, pageSize: 10 }, signal: controller.signal }).then(({ data }) => { if (!controller.signal.aborted) setData(data); })
      .catch((failure) => { if (!controller.signal.aborted) setError(clinicalError(failure)); });
    return () => controller.abort();
  }, [endpoint, page, revision, retry]);
  return <section className="clinical-history" aria-label="Histórico clínico"><h2>Histórico de tratamentos</h2>
    {error ? <><p role="alert">{error}</p><button className="text-button" onClick={() => setRetry((n) => n + 1)}>Tentar carregar histórico novamente</button></> : !data ? <p role="status">A carregar histórico…</p> : <>
      {data.items.length === 0 && <p>Nenhum registo clínico disponível.</p>}
      <ol className="clinical-timeline">{data.items.map((record) => <li key={record.id}><article aria-label={`Registo de ${clinicalDate(record.appointment.startAt, data.timeZone)}`}>
        <header><h3>{clinicalDate(record.appointment.startAt, data.timeZone)}</h3><span className={`status-tag ${record.finalizedAt ? 'status-confirmed' : 'status-waiting'}`}>{record.finalizedAt ? 'Finalizado' : 'Rascunho'}</span></header>
        <p>Dentista: {record.appointment.dentist.name}</p><p>Autor: {record.author.name}</p>
        {record.finalizedAt && <p>Finalizado em {clinicalDate(record.finalizedAt, data.timeZone)}</p>}
        <ClinicalContents record={record} timeZone={data.timeZone} />
      </article></li>)}</ol>
    </>}
    <nav className="pagination" aria-label="Páginas do histórico"><button disabled={page === 1 || !data} onClick={() => setPage((n) => n - 1)}>Anterior</button><span>Página {page}</span><button disabled={!data?.hasMore} onClick={() => setPage((n) => n + 1)}>Seguinte</button></nav>
  </section>;
}
