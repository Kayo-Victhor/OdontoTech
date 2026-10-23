import { useRef, useState, type FormEvent } from 'react';
import { DateTime } from 'luxon';
import { api } from '../services/api';
import { appointmentError, clinicInstant, type Appointment, type ClinicConfig } from '../services/appointments';
import { ProfileSelect } from './ProfileSelect';
import { AgendaDialog } from './AgendaDialog';

export function AppointmentForm({ appointment, date, config, onClose, onRefresh }: { appointment?: Appointment; date: string; config: ClinicConfig; onClose: () => void; onRefresh: () => void }) {
  const initialStart = appointment ? DateTime.fromISO(appointment.startAt).setZone(config.timeZone) : DateTime.fromISO(date, { zone: config.timeZone }).set({ hour: config.startHour });
  const initialEnd = appointment ? DateTime.fromISO(appointment.endAt).setZone(config.timeZone) : initialStart.plus({ minutes: config.slotMinutes });
  const [patientId, setPatient] = useState(appointment?.patientId || '');
  const [dentistId, setDentist] = useState(appointment?.dentistId || '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = new FormData(event.currentTarget);
    let startAt: string; let endAt: string;
    try {
      startAt = clinicInstant(String(form.get('date')), String(form.get('startTime')), config.timeZone);
      endAt = clinicInstant(String(form.get('endDate')), String(form.get('endTime')), config.timeZone);
      if (Date.parse(endAt) <= Date.parse(startAt)) throw new Error('O término deve ser posterior ao início.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Horários inválidos.'); return; }
    submitting.current = true; setPending(true); setError('');
    try {
      const body = { patientId, dentistId, startAt, endAt, reason: String(form.get('reason') || '').trim() || null };
      if (appointment) await api.patch(`/appointments/${appointment.id}`, body); else await api.post('/appointments', body);
      onRefresh(); onClose();
    } catch (failure) { setError(appointmentError(failure)); onRefresh(); }
    finally { submitting.current = false; setPending(false); }
  }
  return <AgendaDialog title={appointment ? 'Editar consulta' : 'Novo agendamento'} pending={pending} onClose={onClose}>
    <p className="field-hint">Horários da clínica: {config.timeZone}</p>
    <form onSubmit={submit}><fieldset disabled={pending} className="account-fields">
      <ProfileSelect kind="patients" label="Paciente" value={patientId} onChange={setPatient} selected={appointment?.patient} required />
      <ProfileSelect kind="dentists" label="Dentista" value={dentistId} onChange={setDentist} selected={appointment?.dentist} required />
      <div className="agenda-form-grid">
        <label className="field"><span>Data</span><span className="field-control"><input type="date" name="date" defaultValue={initialStart.toISODate()!} required /></span></label>
        <label className="field"><span>Hora de início</span><span className="field-control"><input type="time" name="startTime" defaultValue={initialStart.toFormat('HH:mm')} required /></span></label>
        <label className="field"><span>Data de término</span><span className="field-control"><input type="date" name="endDate" defaultValue={initialEnd.toISODate()!} required /></span></label>
        <label className="field"><span>Hora de término</span><span className="field-control"><input type="time" name="endTime" defaultValue={initialEnd.toFormat('HH:mm')} required /></span></label>
      </div>
      <label className="field"><span>Motivo (opcional)</span><textarea name="reason" maxLength={1000} defaultValue={appointment?.reason || ''} /></label>
      <button className="submit-button" type="submit" disabled={pending}>{pending ? 'A guardar…' : 'Guardar consulta'}</button>
    </fieldset>{error && <p role="alert" className="form-message form-message--error">{error}</p>}</form>
  </AgendaDialog>;
}
