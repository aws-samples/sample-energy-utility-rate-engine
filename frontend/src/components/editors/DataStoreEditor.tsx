import React, { useState, useEffect } from 'react';
import FactorsEditor from './FactorsEditor';
import { Scenario } from '../../types/updatedRates';

const DataStoreEditor: React.FC = () => {
  const [selectedScenario, setSelectedScenario] = useState<Scenario>(
    (sessionStorage.getItem('selectedScenario') as Scenario) || 'DEFAULT'
  );

  useEffect(() => {
    const handleScenarioChange = () => {
      const newScenario = sessionStorage.getItem('selectedScenario') as Scenario;
      if (newScenario) {
        setSelectedScenario(newScenario);
      }
    };

    window.addEventListener('scenarioChanged', handleScenarioChange);
    return () => window.removeEventListener('scenarioChanged', handleScenarioChange);
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <FactorsEditor scenario={selectedScenario} />
    </div>
  );
};

export default DataStoreEditor;
