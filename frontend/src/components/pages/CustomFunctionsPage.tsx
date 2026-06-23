import React, { useState, useEffect } from 'react';
import { Loader2, AlertCircle, Info, X, ChevronDown } from 'lucide-react';
import { Alert, AlertDescription, AlertAction } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { CustomFunctionsService, CustomFunction } from '../../services/custom-functions-service';

const CustomFunctionsPage: React.FC = () => {
  const [customFunctions, setCustomFunctions] = useState<CustomFunction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchFunctions = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const functions = await CustomFunctionsService.getAll();
        setCustomFunctions(functions);
      } catch (err) {
        console.error('Error loading custom functions:', err);
        setError('Failed to load custom functions. Please try again.');
      } finally {
        setIsLoading(false);
      }
    };
    fetchFunctions();
  }, []);

  const renderFunctionCard = (func: CustomFunction) => (
    <AccordionItem key={func.id} value={func.id} className="border rounded-lg px-4">
      <AccordionTrigger className="py-3">
        <div>
          <div className="font-medium">{func.name}</div>
          <div className="text-sm text-muted-foreground">{func.description}</div>
        </div>
      </AccordionTrigger>
      <AccordionContent>
        <div className="flex flex-col gap-4">
          <code className="bg-muted px-2 py-1 rounded text-sm">{func.signature}</code>

          <div>
            <span className="font-semibold">Parameters:</span>
            <ul className="list-disc pl-5 mt-1">
              {func.parameters.map((param, idx) => (
                <li key={idx}>
                  <code className="bg-muted px-1 rounded text-sm">{param.name}</code> ({param.type}): {param.description}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <span className="font-semibold">Returns:</span>
            <div>
              <code className="bg-muted px-1 rounded text-sm">{func.returns.type}</code> - {func.returns.description}
            </div>
          </div>

          <div>
            <span className="font-semibold">Example:</span>
            <div>
              <code className="bg-muted px-2 py-1 rounded text-sm text-blue-600 dark:text-blue-400">{func.example}</code>
            </div>
          </div>

          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1 px-0">
                <ChevronDown className="size-4" />
                View Rust Implementation
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre className="bg-muted p-3 rounded-md mt-2 overflow-x-auto">
                <code className="text-xs whitespace-pre-wrap">{func.rustCode}</code>
              </pre>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </AccordionContent>
    </AccordionItem>
  );

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
        <span className="text-muted-foreground">Loading custom functions...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>{error}</AlertDescription>
          <AlertAction>
            <Button variant="ghost" size="icon" onClick={() => setError(null)}>
              <X className="size-4" />
            </Button>
          </AlertAction>
        </Alert>
      )}

      <p className="text-muted-foreground">
        Custom functions extend the Rate Definition Language (RDL) with utility-specific logic.
        These functions are implemented in Rust for high performance and type safety.
        Click "View Rust Implementation" to see the source code.
      </p>

      {customFunctions.length > 0 ? (
        <Accordion type="multiple">
          {customFunctions.map(renderFunctionCard)}
        </Accordion>
      ) : (
        <Alert>
          <Info className="size-4" />
          <AlertDescription>
            No custom functions found. Custom functions can be added to the database to extend the RDL.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
};

export default CustomFunctionsPage;
