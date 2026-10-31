import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { OFFICE_DEPARTMENTS, OFFICE_DESKS, type OfficeAppearance, type OfficeSeat } from '@frontline/shared';
import { Button, ErrorState, Field, inputClass } from '../components/ui';
import { officeApi, useSeats } from './api';
import { AppearanceEditor } from './AppearanceEditor';
import { resolveAppearance } from './characters';

export function SeatEditor({ seat, onSaved, role }: { role?: string; seat: OfficeSeat; onSaved: () => void }) {
  const seats = useSeats(), qc = useQueryClient();
  const [name, setName] = useState(seat.displayName), [appearance, setAppearance] = useState<OfficeAppearance>(resolveAppearance(seat.appearance, seat.agentId)), [deskId, setDeskId] = useState(seat.deskId);
  const save = useMutation({ mutationFn: () => officeApi(`/api/ecosystem/seats/${encodeURIComponent(seat.agentId)}`, 'PATCH', { displayName: name.trim(), appearance, deskId }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['ecosystem', 'seats'] }); onSaved(); } });
  const desks = OFFICE_DESKS.filter((d) => !seats.data?.some((s) => s.agentId !== seat.agentId && !s.archived && s.deskId === d.id));
  return <form className="eco-command eco-deploy" onSubmit={(e) => { e.preventDefault(); if (!save.isPending) save.mutate(); }}>
    <h3>Customize worker</h3><Field label="Office name"><input className={inputClass} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></Field>
    <Field label="Assigned workstation"><select className={inputClass} value={deskId} onChange={(e) => setDeskId(e.target.value)}>{desks.map((d) => <option key={d.id} value={d.id}>{OFFICE_DEPARTMENTS.find((room) => room.id === d.department)!.name} · {d.id}</option>)}</select></Field>
    <AppearanceEditor role={role ?? seat.agentId.split(':').at(-1)} value={appearance} onChange={setAppearance} />
    {save.error && <ErrorState message={save.error.message} />}<Button type="submit" variant="primary" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save worker appearance'}</Button>
  </form>;
}
