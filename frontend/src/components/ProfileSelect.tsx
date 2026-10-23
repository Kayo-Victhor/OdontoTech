import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { appointmentError, type ProfileOption } from '../services/appointments';

export function ProfileSelect({ kind, label, value, onChange, selected, required = false }: {
  kind: 'patients' | 'dentists'; label: string; value: string; onChange: (value: string) => void; selected?: ProfileOption; required?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<ProfileOption[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [chosen, setChosen] = useState<ProfileOption | undefined>(selected);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    if (page === 1) setItems([]);
    api.get<{ items: ProfileOption[]; hasMore: boolean }>('/appointments/options', { params: { kind, search, page, pageSize: 20 }, signal: controller.signal })
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        setItems((previous) => [...new Map([...(page === 1 ? [] : previous), ...data.items].map((item) => [item.id, item])).values()]);
        setHasMore(data.hasMore);
      }).catch((failure) => { if (!controller.signal.aborted) setError(appointmentError(failure)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [kind, search, page, revision]);
  const keep = selected?.id === value ? selected : chosen?.id === value ? chosen : undefined;
  const options = keep && !items.some((item) => item.id === keep.id) ? [keep, ...items] : items;
  return <div className="profile-picker">
    <label className="field"><span>Pesquisar {label.toLowerCase()}</span><span className="field-control"><input type="search" value={search} maxLength={80} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></span></label>
    <label className="field"><span>{label}</span><select required={required} value={value} onChange={(event) => { setChosen(options.find((item) => item.id === event.target.value)); onChange(event.target.value); }}>
      <option value="">{required ? 'Selecione' : 'Todos os profissionais'}</option>
      {options.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select></label>
    {loading && <small role="status">A carregar {label.toLowerCase()}…</small>}
    {error && <><p role="alert" className="field-error">{error}</p><button className="text-button" type="button" onClick={() => setRevision((v) => v + 1)}>Repetir pesquisa</button></>}
    {hasMore && !loading && <button type="button" className="text-button" onClick={() => setPage((value) => value + 1)}>Carregar mais {label.toLowerCase()}</button>}
  </div>;
}
