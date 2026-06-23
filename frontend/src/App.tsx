import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Authenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import { TooltipProvider } from '@/components/ui/tooltip';
import AuthenticatedLayout from './components/layout/AuthenticatedLayout';
import ScenariosPage from './components/pages/ScenariosPage';
import CalculationEditor from './components/editors/CalculationEditor';
import DataStoreEditor from './components/editors/DataStoreEditor';
import InputValidationEditor from './components/editors/InputValidationEditor';
import CustomFunctionsPage from './components/pages/CustomFunctionsPage';
import TestCalculationPage from './components/pages/TestCalculationPage';
import BatchAnalyticsPage from './components/pages/BatchAnalyticsPage';

const pages = [
  { path: '/scenarios', component: ScenariosPage },
  { path: '/calculation', component: CalculationEditor, fullWidth: true },
  { path: '/data-stores', component: DataStoreEditor },
  { path: '/input-validation', component: InputValidationEditor },
  { path: '/functions', component: CustomFunctionsPage },
  { path: '/test', component: TestCalculationPage },
  { path: '/batch-analytics', component: BatchAnalyticsPage },
];

function App() {
  return (
    <TooltipProvider>
      <Authenticator hideSignUp={true}>
        {({ signOut, user }) => (
          <Router>
            <Routes>
              {pages.map(({ path, component: Component, fullWidth }) => (
                <Route
                  key={path}
                  path={path}
                  element={
                    <AuthenticatedLayout signOut={signOut} user={user}>
                      <div className={fullWidth ? 'w-full' : 'max-w-7xl mx-auto'}>
                        <Component />
                      </div>
                    </AuthenticatedLayout>
                  }
                />
              ))}
              <Route path="/" element={<Navigate to="/calculation" replace />} />
              <Route path="*" element={<Navigate to="/calculation" replace />} />
            </Routes>
          </Router>
        )}
      </Authenticator>
    </TooltipProvider>
  );
}

export default App;
