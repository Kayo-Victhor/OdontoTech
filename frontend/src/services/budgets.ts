import axios from 'axios';

export interface BudgetOption { id: string; name: string; description?: string | null; unitPrice?: string | null }
export interface SimulationPlan { count: number; regularAmount: string; lastAmount: string; adjustment: string; amounts: string[] }
export interface BudgetSimulation {
  clinicName: string; createdAt: string; timeZone: string; patient: { id: string; name: string };
  dentist: { id: string; name: string; croNumber: string; croState: string };
  items: { procedureId: string; name: string; description: string | null; quantity: number; unitPrice: string; subtotal: string }[];
  total: string; currency: 'BRL'; selectedInstallments: number; plans: SimulationPlan[]; persisted: false; notice: string;
}
// Apenas apresentação de strings monetárias; os cálculos são feitos com Decimal na API.
export function budgetMoney(value: string) {
  const [integer, decimals] = value.split('.');
  return `R$ ${integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${decimals}`;
}
export function budgetError(error: unknown) {
  if (axios.isAxiosError(error)) {
    switch (error.response?.status) {
      case 400: return 'Verifique os procedimentos, as quantidades (1 a 100) e o número de parcelas (1 a 12).';
      case 401: return 'A sessão expirou. Entre novamente.';
      case 403: return 'Esta simulação exige um perfil de dentista ativo.';
      case 404: return 'Paciente inexistente ou sem vínculo autorizado com o dentista.';
      case 409: return 'Há procedimentos sem preço configurado no catálogo. Solicite à administração a configuração antes de simular.';
    }
  }
  return 'Não foi possível carregar ou calcular a simulação. Tente novamente.';
}
