import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import axios from 'axios';
import { api } from '../services/api';
import { clinicalDate, clinicalError, type ClinicalContext, type ClinicalRecord } from '../services/clinical';
import { statusNames } from '../services/appointments';
import { AgendaDialog } from '../components/AgendaDialog';
import { ClinicalContents, ClinicalHistory } from '../components/ClinicalHistory';
import { ClinicalProcedureForm } from '../components/ClinicalProcedureForm';

export function ClinicalPage() {
  const { appointmentId } = useParams(); const endpoint = `/clinical/appointments/${appointmentId}`;
  const [context, setContext] = useState<ClinicalContext | null>(null); const [notes, setNotes] = useState('');
  const [loadError, setLoadError] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0); const [historyRevision, setHistoryRevision] = useState(0);
  const [pending, setPending] = useState(false); const [stale, setStale] = useState(false); const [dialog, setDialog] = useState<'finalize' | 'reload' | null>(null); const busy = useRef(false);
  useEffect(() => {
    const controller = new AbortController(); setContext(null); setLoadError(''); setError(''); setStale(false); setNotice('');
    api.get<ClinicalContext>(endpoint, { signal: controller.signal }).then(({ data }) => { if (!controller.signal.aborted) { setContext(data); setNotes(data.record?.notes ?? ''); } })
      .catch((failure) => { if (!controller.signal.aborted) setLoadError(clinicalError(failure)); });
    return () => controller.abort();
  }, [endpoint, revision]);
  async function mutate(method: 'post' | 'patch', suffix: string, data: unknown, message: string) {
    if (busy.current || stale) return false;
    busy.current = true; setPending(true); setError(''); setNotice('');
    try {
      const response = await api[method]<{ record: ClinicalRecord }>(endpoint + suffix, data);
      setContext((current) => current ? { ...current, record: response.data.record } : current);
      if (method === 'patch' || suffix === '') setNotes(response.data.record.notes);
      setHistoryRevision((n) => n + 1); setNotice(message); setDialog(null); return true;
    } catch (failure) {
      setError(clinicalError(failure));
      if (axios.isAxiosError(failure) && failure.response?.status === 409) setStale(true);
      setDialog(null); return false;
    } finally { busy.current = false; setPending(false); }
  }
  const record = context?.record; const dirty = Boolean(record && notes !== record.notes);
  const eligible = Boolean(context && ['IN_PROGRESS', 'COMPLETED'].includes(context.appointment.status));
  const disabled = pending || stale;
  return <main className="agenda-page clinical-page"><header className="admin-header"><div><p className="brand-name">Odonto<span>Tech</span></p><h1>Prontuário clínico</h1></div><Link to="/agenda">Voltar à agenda</Link></header>
    {loadError ? <><p role="alert">{loadError}</p><button className="text-button" onClick={() => setRevision((n) => n + 1)}>Tentar novamente</button></> : !context ? <p role="status">A carregar prontuário…</p> : <>
      <section className="clinical-patient" aria-label="Identificação do paciente"><h2>{context.appointment.patient.name}</h2><p>Nascimento: {context.appointment.patient.birthDate?.split('-').reverse().join('/') || 'Não informado'}</p><p>Contacto: {context.appointment.patient.phone || 'Não informado'}</p><p>Identificação do paciente: {context.appointment.patient.id}</p></section>
      <section className="clinical-context" aria-label="Contexto da consulta"><p>Consulta: {clinicalDate(context.appointment.startAt, context.timeZone)} · {context.timeZone}</p><p>Dentista: {context.appointment.dentist.name}</p><p>Estado da consulta: {statusNames[context.appointment.status]}</p><p>Registo clínico: <strong>{record ? record.finalizedAt ? 'Finalizado — leitura' : 'Rascunho' : 'Não iniciado'}</strong></p></section>
      {error && <p role="alert" className="form-message--error">{error}</p>}{notice && <p role="status">{notice}</p>}
      <button className="text-button" disabled={pending} onClick={() => { if (dirty) setDialog('reload'); else setRevision((n) => n + 1); }}>Recarregar prontuário</button>
      {stale && <p role="alert">As alterações locais não foram enviadas novamente. Recarregue para obter a versão atual do servidor.</p>}
      {!record ? <section className="clinical-panel"><p>Nenhum registo iniciado para esta consulta.</p>{eligible ? <button className="submit-button" disabled={disabled} onClick={() => void mutate('post', '', {}, 'Rascunho iniciado.')}>Iniciar rascunho</button> : <p>O registo só pode ser iniciado em consultas em atendimento ou concluídas.</p>}</section> : <>
        <section className="clinical-panel" aria-label="Registo atual"><h2>{record.finalizedAt ? 'Registo finalizado' : 'Rascunho clínico'}</h2><p>Autor: {record.author.name}</p>
          {record.finalizedAt ? <><p>Finalizado em {clinicalDate(record.finalizedAt, context.timeZone)}. Correções devem ser feitas por aditamento.</p><ClinicalContents record={record} timeZone={context.timeZone} /></> : <>
            {!eligible && <p role="alert">O estado atual da consulta não permite alterações neste rascunho.</p>}
            <form onSubmit={(e) => { e.preventDefault(); void mutate('patch', '', { notes, expectedUpdatedAt: record.updatedAt }, 'Rascunho guardado.'); }}><fieldset className="account-fields" disabled={disabled || !eligible}><label className="field"><span>Notas clínicas</span><textarea value={notes} maxLength={4000} onChange={(e) => setNotes(e.target.value)} /></label><p className="field-hint">Até 4000 caracteres. Guardar rascunho não finaliza o registo.</p><button className="submit-button" disabled={disabled || !eligible}>{pending ? 'A guardar…' : 'Guardar rascunho'}</button></fieldset></form>
            <ClinicalContents record={record} timeZone={context.timeZone} showNotes={false} />
            <p className="field-hint">Para finalizar, guarde as notas e adicione pelo menos um procedimento.</p><button className="submit-button" disabled={disabled || !eligible || dirty || !record.notes.trim() || !record.procedures.length} onClick={() => setDialog('finalize')}>Finalizar registo</button>
          </>}
        </section>
        {!record.finalizedAt && eligible && <ClinicalProcedureForm pending={disabled} onAdd={(data) => mutate('post', '/procedures', { ...data, expectedUpdatedAt: record.updatedAt }, 'Procedimento registado.')} />}
        {record.finalizedAt && <section className="clinical-panel"><h2>Novo aditamento</h2><p>O texto original permanece inalterado. Um aditamento não pode ser editado ou eliminado.</p><form onSubmit={async (e) => { e.preventDefault(); const form = e.currentTarget; const content = String(new FormData(form).get('content') || '').trim(); if (await mutate('post', '/addenda', { content }, 'Aditamento acrescentado.')) form.reset(); }}><fieldset className="account-fields" disabled={disabled}><label className="field"><span>Texto do aditamento</span><textarea name="content" required maxLength={4000} /></label><button className="submit-button" disabled={disabled}>Acrescentar aditamento</button></fieldset></form></section>}
      </>}
      <ClinicalHistory key={endpoint} endpoint={`${endpoint}/history`} revision={historyRevision} />
    </>}
    {dialog === 'finalize' && record && <AgendaDialog title="Finalizar registo clínico" pending={pending} onClose={() => setDialog(null)}><p>O registo e os procedimentos ficarão bloqueados para edição. Futuras correções serão feitas por aditamentos. O estado da consulta não será alterado.</p><button className="submit-button" disabled={disabled} onClick={() => void mutate('post', '/finalize', { expectedUpdatedAt: record.updatedAt }, 'Registo finalizado.')}>{pending ? 'A finalizar…' : 'Confirmar finalização'}</button></AgendaDialog>}
    {dialog === 'reload' && <AgendaDialog title="Descartar alterações locais?" onClose={() => setDialog(null)}><p>As notas ainda não guardadas serão substituídas pela versão do servidor.</p><button className="submit-button" onClick={() => { setDialog(null); setRevision((n) => n + 1); }}>Descartar e recarregar</button></AgendaDialog>}
  </main>;
}
