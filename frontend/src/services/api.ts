import axios from 'axios';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  withCredentials: true,
  timeout: 15000,
  headers: { 'X-OdontoTech-CSRF': '1' },
});
api.interceptors.response.use((response) => response, (error: unknown) => {
  if (axios.isAxiosError(error) && error.response?.status === 401) window.dispatchEvent(new Event('auth:unauthorized'));
  return Promise.reject(error);
});
export function authErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 401) return 'E-mail ou senha inválidos';
    if (error.response?.status === 429) return 'Muitas tentativas. Aguarde antes de tentar novamente.';
    if (error.response?.status === 400) return 'Informe um e-mail válido e a senha.';
  }
  return 'Não foi possível concluir o pedido. Verifique a conexão e tente novamente.';
}
