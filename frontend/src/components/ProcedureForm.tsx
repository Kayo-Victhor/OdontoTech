import type { FormEvent } from 'react';
import { procedureFields, type CatalogProcedure, type ProcedureInput } from '../services/procedures';

export function ProcedureForm({ procedure, pending, onSave, onCancel, onError }: { procedure: CatalogProcedure | null; pending: boolean; onSave: (input: ProcedureInput) => void; onCancel: () => void; onError: (message: string) => void }) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending) return;
    try { onSave(procedureFields(event.currentTarget)); } catch (failure) { onError(failure instanceof Error ? failure.message : 'Dados inválidos.'); }
  }
  return <form className="login-form registration-form" onSubmit={submit}><h2>{procedure ? 'Editar procedimento' : 'Novo procedimento'}</h2><fieldset className="account-fields" disabled={pending}>
    <label className="field"><span>Nome do procedimento</span><span className="field-control"><input name="name" required minLength={2} maxLength={191} defaultValue={procedure?.name ?? ''} /></span></label>
    <label className="field"><span>Descrição (opcional)</span><textarea name="description" maxLength={2000} defaultValue={procedure?.description ?? ''} /></label>
    <label className="field"><span>Preço padrão (R$)</span><span className="field-control"><input name="defaultPrice" type="text" inputMode="decimal" maxLength={11} placeholder="Não configurado" defaultValue={procedure?.defaultPrice ?? ''} /></span></label>
    <p className="field-hint">Vazio significa preço não configurado. Zero é um preço explícito; não há arredondamento de casas extras no cadastro.</p>
    <label className="field"><span>Duração estimada em minutos (opcional)</span><span className="field-control"><input name="estimatedDurationMinutes" type="number" min={1} max={1440} step={1} defaultValue={procedure?.estimatedDurationMinutes ?? ''} /></span></label>
    <label className="catalog-checkbox"><input type="checkbox" name="isActive" defaultChecked={procedure?.isActive ?? true} />Disponível no catálogo ativo</label>
    <button className="submit-button" type="submit" disabled={pending}>{pending ? 'A guardar…' : procedure ? 'Guardar alterações' : 'Cadastrar procedimento'}</button>
    {procedure && <button className="text-button" type="button" disabled={pending} onClick={onCancel}>Cancelar edição</button>}
  </fieldset></form>;
}
