import { useEffect, useState } from 'react';
import { DateTime } from 'luxon';
import { api } from '../services/api';
import { appointmentError, statusNames, type Appointment } from '../services/appointments';
import { AgendaDialog } from './AgendaDialog';

export function AppointmentDetails({ id, timeZone, onClose }: { id: string; timeZone: string; onClose: () => void }) {
  const [appointment, setAppointment] = useState<Appointment | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    api.get<{ appointment: Appointment }>(`/appointments/${id}`, { signal: controller.signal }).then(({ data }) => { if (!controller.signal.aborted) setAppointment(data.appointment); })
      .catch((failure) => { if (!controller.signal.aborted) setError(appointmentError(failure)); });
    return () => controller.abort();
  }, [id]);
  return <AgendaDialog title="Detalhes da consulta" onClose={onClose}>
    {error ? <p role="alert">{error}</p> : !appointment ? <p role="status">A carregar consulta…</p> : <dl className="appointment-details">
      <dt>Paciente</dt><dd>{appointment.patient.name}</dd><dt>Dentista</dt><dd>{appointment.dentist.name}</dd>
      <dt>Início</dt><dd>{DateTime.fromISO(appointment.startAt).setZone(timeZone).toFormat('dd/MM/yyyy HH:mm')}</dd>
      <dt>Término</dt><dd>{DateTime.fromISO(appointment.endAt).setZone(timeZone).toFormat('dd/MM/yyyy HH:mm')}</dd>
      <dt>Estado</dt><dd>{statusNames[appointment.status]}</dd><dt>Motivo</dt><dd>{appointment.reason || 'Não informado'}</dd>
      {appointment.cancellationReason && <><dt>Motivo do cancelamento</dt><dd>{appointment.cancellationReason}</dd></>}
    </dl>}
  </AgendaDialog>;
}
