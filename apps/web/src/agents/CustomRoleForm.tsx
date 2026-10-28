import { useState, type FormEvent } from 'react';
import { AGENT_ROLES, type AgentRole, type CustomRole, type Store } from '@frontline/shared';
import { useAgentTypes, useCreateCustomRole } from '../api/client';
import { Button, cx, Dialog, Field, inputClass } from '../components/ui';
import { toolLabel } from './Details';

// The custom-role form (decision 2): a name, a description and instructions on top of an agent type, whose tools it can
// narrow, never add to. Deploy's "+ Custom role" (AA-14) opens it.

const ROLE_IDS = Object.keys(AGENT_ROLES) as AgentRole[];

export function CustomRoleForm({ store, open, onClose, onCreated }: { store: Store; open: boolean; onClose: () => void; onCreated: (role: CustomRole) => void }) {
  const types = useAgentTypes(store.id).data;
  const create = useCreateCustomRole(store.id);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [baseRole, setBaseRole] = useState<AgentRole>('copywriter');
  const [off, setOff] = useState<string[]>([]);
  const [allStores, setAllStores] = useState(false);
  // compare_stores belongs to the Analytics Specialist type alone.
  const tools = (types?.find((t) => t.id === baseRole)?.contract.tools ?? []).filter((t) => t !== 'compare_stores');
  const error = create.error as (Error & { field?: string }) | null;
  const said = (field: string) => error?.field === field && <span className="text-xs text-[#ff6b76]">{error.message}</span>;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const picked = tools.filter((t) => !off.includes(t));
    create.mutate(
      { name, description, instructions, baseRole, ...(off.length ? { tools: picked } : {}), allStores },
      {
        onSuccess: (role) => {
          onCreated(role);
          onClose();
        },
      },
    );
  };
  return (
    <Dialog open={open} onClose={onClose} title="New custom role">
      <form onSubmit={submit} className="grid gap-3.5">
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} placeholder="e.g. Brand Voice" className={inputClass} />
          {said('name')}
        </Field>
        <Field label="Builds on">
          <select
            value={baseRole}
            onChange={(e) => {
              setBaseRole(e.target.value as AgentRole);
              setOff([]);
            }}
            className={cx(inputClass, 'cursor-pointer')}
          >
            {ROLE_IDS.map((r) => (
              <option key={r} value={r}>
                {AGENT_ROLES[r].name}
              </option>
            ))}
          </select>
          {said('baseRole')}
        </Field>
        <Field label="Description">
          <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} placeholder="What it's for, in a line" className={inputClass} />
          {said('description')}
        </Field>
        <Field label="Instructions">
          <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={4000} rows={5} placeholder="How it works, on top of the agent type's own" className={cx(inputClass, 'resize-y')} />
          {said('instructions')}
        </Field>
        <fieldset className="grid gap-1.5">
          <legend className="mb-1 text-xs text-muted">Tools: only the {AGENT_ROLES[baseRole].name}'s, and you can switch some off</legend>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {tools.map((t) => (
              <label key={t} className="flex items-center gap-2 text-[13px] text-text-2">
                <input type="checkbox" checked={!off.includes(t)} onChange={(e) => setOff(e.target.checked ? off.filter((x) => x !== t) : [...off, t])} className="accent-red" />
                {toolLabel(t)}
              </label>
            ))}
          </div>
          {said('tools')}
        </fieldset>
        <label className="flex items-center gap-2 text-[13px] text-text-2">
          <input type="checkbox" checked={allStores} onChange={(e) => setAllStores(e.target.checked)} className="accent-red" />
          Offer it in all my stores, not only {store.name}
        </label>
        {error && !error.field && <p className="text-xs text-[#ff6b76]">{error.message}</p>}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={create.isPending || tools.length === off.length}>
            Create role
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
