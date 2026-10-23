import { Link } from 'react-router-dom';
import { ClinicalHistory } from '../components/ClinicalHistory';

export function PatientHistoryPage() {
  return <main className="agenda-page clinical-page"><header className="admin-header"><div><p className="brand-name">Odonto<span>Tech</span></p><h1>O meu histórico clínico</h1></div><Link to="/paciente">Voltar à minha área</Link></header><p>Apenas os seus registos finalizados, apresentados do mais recente para o mais antigo.</p><ClinicalHistory endpoint="/clinical/history" /></main>;
}
