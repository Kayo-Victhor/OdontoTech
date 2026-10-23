import axios from 'axios';

export interface CatalogProcedure { id: string; name: string; description: string | null; defaultPrice: string | null; estimatedDurationMinutes: number | null; isActive: boolean; createdAt: string; updatedAt: string }
export interface ProcedureInput { name: string; description: string | null; defaultPrice: string | null; estimatedDurationMinutes: number | null; isActive: boolean }
export function procedureError(error: unknown) {
  if (axios.isAxiosError(error)) {
    switch (error.response?.status) {
      case 400: return 'Verifique o nome, o preço (até duas casas decimais) e a duração (1 a 1440 minutos).';
      case 401: return 'A sessão expirou. Entre novamente.';
      case 403: return 'Apenas administradores podem gerir o catálogo.';
      case 404: return 'Procedimento não encontrado. Atualize a lista.';
      case 409: return 'Conflito no catálogo. Atualize os dados e tente novamente.';
    }
  }
  return 'Não foi possível carregar ou guardar o catálogo. Tente novamente.';
}
export function procedureFields(form: HTMLFormElement): ProcedureInput {
  const data = new FormData(form);
  const price = String(data.get('defaultPrice') || '').trim().replace(',', '.');
  const duration = String(data.get('estimatedDurationMinutes') || '').trim();
  if (price && !/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/.test(price)) throw new Error('Informe um preço não negativo com até duas casas, ou deixe vazio para não configurado.');
  if (duration && (!/^\d+$/.test(duration) || Number(duration) < 1 || Number(duration) > 1440)) throw new Error('Duração deve ser um inteiro entre 1 e 1440 minutos, ou ficar vazia.');
  return { name: String(data.get('name') || '').trim().replace(/\s+/g, ' '), description: String(data.get('description') || '').trim() || null, defaultPrice: price || null, estimatedDurationMinutes: duration ? Number(duration) : null, isActive: data.get('isActive') === 'on' };
}
