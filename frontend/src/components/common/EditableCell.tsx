import React, { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { CalendarIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, parse } from 'date-fns';

export type CellType = 'text' | 'number' | 'date' | 'select';

interface SelectOption {
  label: string;
  value: string;
}

interface EditableCellProps {
  value: string | number | undefined;
  onChange: (newValue: string | number) => void;
  type?: CellType;
  selectOptions?: SelectOption[];
  formatDisplay?: (value: string | number | undefined) => string;
  placeholder?: string;
  disabled?: boolean;
}

const EditableCell: React.FC<EditableCellProps> = ({
  value,
  onChange,
  type = 'text',
  selectOptions,
  formatDisplay,
  placeholder = '',
  disabled = false
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState<string>(String(value ?? ''));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditValue(String(value ?? ''));
  }, [value]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleDoubleClick = () => {
    if (!disabled) setIsEditing(true);
  };

  const handleSave = () => {
    setIsEditing(false);
    let newValue: string | number = editValue;
    if (type === 'number' && editValue !== '') {
      newValue = parseFloat(editValue) || 0;
    }
    if (String(newValue) !== String(value)) {
      onChange(newValue);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
    else if (e.key === 'Escape') {
      setEditValue(String(value ?? ''));
      setIsEditing(false);
    }
  };

  const displayValue = formatDisplay ? formatDisplay(value) : String(value ?? '');

  if (isEditing) {
    if (type === 'select' && selectOptions) {
      return (
        <Select
          value={editValue}
          onValueChange={(val) => {
            setEditValue(val);
            setIsEditing(false);
            onChange(val);
          }}
        >
          <SelectTrigger className="h-8 w-full" autoFocus>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {selectOptions.map(opt => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    if (type === 'date') {
      const dateVal = editValue && editValue !== '9999-12-31'
        ? parse(editValue, 'yyyy-MM-dd', new Date())
        : undefined;

      return (
        <Popover open onOpenChange={(open) => { if (!open) handleSave(); }}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn('h-8 w-full justify-start text-left font-normal', !dateVal && 'text-muted-foreground')}
            >
              <CalendarIcon className="mr-2 size-4" />
              {dateVal ? format(dateVal, 'yyyy-MM-dd') : 'YYYY-MM-DD'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={dateVal}
              onSelect={(date) => {
                const formatted = date ? format(date, 'yyyy-MM-dd') : '9999-12-31';
                setEditValue(formatted);
                onChange(formatted);
                setIsEditing(false);
              }}
              initialFocus
            />
          </PopoverContent>
        </Popover>
      );
    }

    return (
      <Input
        ref={inputRef}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        type={type === 'number' ? 'number' : 'text'}
        placeholder={placeholder}
        className="h-8"
        autoFocus
      />
    );
  }

  return (
    <div
      onDoubleClick={handleDoubleClick}
      className={cn(
        'min-h-5 rounded-sm px-2 py-1 transition-colors',
        !disabled && 'cursor-pointer hover:bg-muted'
      )}
      title={disabled ? '' : 'Double-click to edit'}
    >
      {displayValue || <span className="text-muted-foreground">{placeholder || '-'}</span>}
    </div>
  );
};

export default EditableCell;
