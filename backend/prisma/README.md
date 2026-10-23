# Regras operacionais necessárias

O schema preserva integridade referencial e índices de consulta, mas MySQL não possui uma restrição declarativa para impedir intervalos de agendamentos sobrepostos.

O serviço de agendamentos deve validar `endAt > startAt` e, numa transação com bloqueio apropriado, consultar os compromissos do mesmo dentista que se sobreponham ao intervalo solicitado. Estados `CANCELLED` não bloqueiam a agenda. A aplicação deverá também validar os perfis conforme o papel do utilizador e a imutabilidade de prontuários finalizados.

O escopo atual contém utilizadores, pacientes, dentistas, procedimentos, agendamentos e prontuários. Orçamentos, preços, parcelas e pagamentos ficam fora desta etapa.
