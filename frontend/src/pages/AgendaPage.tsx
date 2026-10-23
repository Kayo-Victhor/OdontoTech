import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { DateTime } from 'luxon';
import { api } from '../services/api';
import { useAuth, rolePaths } from '../auth/AuthProvider';
import { agendaSlots, appointmentError, formatTime, statusNames, statusTransitions, type Appointment, type AppointmentStatus, type ClinicConfig } from '../services/appointments';
import { ProfileSelect } from '../components/ProfileSelect';
import { AppointmentForm } from '../components/AppointmentForm';
import { AppointmentDetails } from '../components/AppointmentDetails';
import { AgendaDialog } from '../components/AgendaDialog';

export function AgendaPage() {
  const { user } = useAuth();
  const operational = user?.role === 'ADMIN' || user?.role === 'RECEPTIONIST';
  const [config, setConfig] = useState<ClinicConfig | null>(null);
  const [configError, setConfigError] = useState('');
  const [date, setDate] = useState('');
  const [dentistId, setDentist] = useState('');
  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const [configRevision, setConfigRevision] = useState(0);
  const [form, setForm] = useState<Appointment | 'new' | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [cancel, setCancel] = useState<Appointment | null>(null);
  const [pending, setPending] = useState(false);
  const mutating = useRef(false);
  const refresh = () => setRevision((value) => value + 1);
  useEffect(() => {
    const controller = new AbortController();
    setConfigError('');
    api.get<ClinicConfig>('/appointments/config', { signal: controller.signal }).then(({ data }) => {
      if (!controller.signal.aborted) { setConfig(data); setDate(DateTime.now().setZone(data.timeZone).toISODate()!); }
    }).catch((failure) => { if (!controller.signal.aborted) setConfigError(appointmentError(failure)); });
    return () => controller.abort();
  }, [configRevision]);
  useEffect(() => {
    if (!date || !config) return;
    const controller = new AbortController();
    setAppointments(null); setLoadError('');
    api.get<{ appointments: Appointment[] }>('/appointments', { params: { date, ...(operational && dentistId ? { dentistId } : {}) }, signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setAppointments(data.appointments); })
      .catch((failure) => { if (!controller.signal.aborted) setLoadError(appointmentError(failure)); });
    return () => controller.abort();
  }, [date, config, dentistId, operational, revision, user?.id]);

  async function changeStatus(appointment: Appointment, status: AppointmentStatus, cancellationReason?: string) {
    if (mutating.current) return;
    mutating.current = true; setPending(true); setNotice('');
    try {
      await api.patch(`/appointments/${appointment.id}/status`, { status, ...(cancellationReason?.trim() ? { cancellationReason: cancellationReason.trim() } : {}) });
      setCancel(null); refresh();
    } catch (failure) { setNotice(appointmentError(failure)); refresh(); }
    finally { mutating.current = false; setPending(false); }
  }
  function card(appointment: Appointment) {
    const transitions = user?.role === 'DENTIST' ? statusTransitions[appointment.status].filter((status) => ['IN_PROGRESS', 'COMPLETED'].includes(status)) : operational ? statusTransitions[appointment.status] : [];
    return <article key={appointment.id} className="appointment-card" aria-label={`Consulta de ${appointment.patient.name}`}>
      <div className="appointment-summary"><strong>{formatTime(appointment.startAt, config!.timeZone)}–{formatTime(appointment.endAt, config!.timeZone)} · {appointment.patient.name}</strong><span className={`status-tag status-${appointment.status.toLowerCase()}`}>{statusNames[appointment.status]}</span></div>
      <p>{appointment.dentist.name}</p>
      <div className="appointment-actions">
        {user?.role === 'DENTIST' && <Link to={`/prontuario/${appointment.id}`}>Prontuário</Link>}
        <button className="text-button" onClick={() => setDetailId(appointment.id)}>Consultar</button>
        {operational && ['SCHEDULED', 'CONFIRMED'].includes(appointment.status) && <button className="text-button" disabled={pending} onClick={() => setForm(appointment)}>Editar</button>}
        {transitions.map((status) => <button className="text-button" key={status} disabled={pending} onClick={() => { if (status === 'CANCELLED') setCancel(appointment); else void changeStatus(appointment, status); }}>{status === 'CANCELLED' ? 'Cancelar' : `Marcar: ${statusNames[status]}`}</button>)}
      </div>
    </article>;
  }
  const grid = config && appointments ? agendaSlots(date, config, appointments) : null;
  return <main className="agenda-page">
    <header className="admin-header"><div><p className="brand-name">Odonto<span>Tech</span></p><h1>Agenda diária</h1></div>{user && <Link to={rolePaths[user.role]}>Voltar à minha área</Link>}</header>
    {!config ? configError ? <><p role="alert">{configError}</p><button className="text-button" onClick={() => setConfigRevision((v) => v + 1)}>Tentar novamente</button></> : <p role="status">A carregar a agenda…</p> : <>
      <section className="agenda-toolbar" aria-label="Filtros da agenda"><label className="field"><span>Data da agenda</span><span className="field-control"><input type="date" value={date} required onChange={(event) => { if (event.target.value) setDate(event.target.value); }} /></span></label>
        {operational && <ProfileSelect kind="dentists" label="Profissional" value={dentistId} onChange={setDentist} />}
        {operational && <button className="submit-button" disabled={pending} onClick={() => setForm('new')}>Novo agendamento</button>}
      </section>
      <p className="field-hint">Horários apresentados em {config.timeZone}. {user?.role === 'PATIENT' ? 'Apenas as suas consultas.' : user?.role === 'DENTIST' ? 'Apenas as suas consultas profissionais.' : 'Disponibilidade calculada por profissional.'}</p>
      {notice && <p role="alert" className="form-message--error">{notice}</p>}
      {loadError ? <><p role="alert">{loadError}</p><button className="text-button" onClick={refresh}>Tentar novamente</button></> : appointments === null ? <p role="status">A carregar consultas…</p> : grid && <>
        {appointments.length === 0 && <p className="agenda-empty">Nenhuma consulta neste dia.</p>}
        <div className="agenda-grid">{grid.slots.map((slot) => <section key={slot.id} className="agenda-slot" aria-label={`Horário ${slot.label}`}><h2>{slot.label}</h2><div>
          <p className={slot.occupied ? 'slot-occupied' : 'slot-free'}>{slot.occupied ? 'Ocupado neste intervalo' : (user?.role === 'DENTIST' || (operational && dentistId)) ? 'Livre' : 'Sem consultas neste intervalo'}</p>
          {slot.appointments.map(card)}
        </div></section>)}</div>
        {grid.outside.length > 0 && <section className="outside-appointments"><h2>Consultas iniciadas fora da grelha</h2>{grid.outside.map(card)}</section>}
      </>}
    </>}
    {form && config && <AppointmentForm appointment={form === 'new' ? undefined : form} date={date} config={config} onClose={() => setForm(null)} onRefresh={refresh} />}
    {detailId && config && <AppointmentDetails id={detailId} timeZone={config.timeZone} onClose={() => setDetailId(null)} />}
    {cancel && <AgendaDialog title="Cancelar consulta" pending={pending} onClose={() => setCancel(null)}><p>Cancelar a consulta de {cancel.patient.name}? O histórico será preservado.</p>
      <form onSubmit={(event) => { event.preventDefault(); const reason = String(new FormData(event.currentTarget).get('cancellationReason') || ''); void changeStatus(cancel, 'CANCELLED', reason); }}>
        <label className="field"><span>Motivo do cancelamento (opcional)</span><textarea name="cancellationReason" maxLength={1000} disabled={pending} /></label>
        <button type="submit" className="submit-button" disabled={pending}>{pending ? 'A cancelar…' : 'Confirmar cancelamento'}</button>
        {notice && <p role="alert">{notice}</p>}
      </form></AgendaDialog>}
  </main>;
}
