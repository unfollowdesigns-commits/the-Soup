import { LabShell } from './components/LabShell';
import { MobileLab } from './mobile/MobileLab';
import { useLab } from './lab/store';
import { EnterLab } from './screens/EnterLab';
import { ImportSpecimen } from './screens/ImportSpecimen';
import { useMediaQuery } from './lab/useMediaQuery';

export default function App() {
  const { screen } = useLab();
  const compact = useMediaQuery('(max-width: 900px)');

  if (screen === 'enter') return <EnterLab />;
  if (screen === 'import') return <ImportSpecimen />;
  return compact ? <MobileLab /> : <LabShell />;
}
