import {
  forwardRef,
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Info } from 'lucide-react';
import { formatEnum } from '@hms/shared';

/* --------------------------------- Buttons --------------------------------- */

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  size?: 'md' | 'sm';
  icon?: ReactNode;
  loading?: boolean;
  iconOnly?: boolean;
}

export function Button({
  variant = 'default',
  size = 'md',
  icon,
  loading,
  iconOnly,
  className = '',
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = [
    'btn',
    variant !== 'default' && `btn-${variant}`,
    size === 'sm' && 'btn-sm',
    iconOnly && 'btn-icon',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button type={type} className={classes} disabled={disabled || loading} {...rest}>
      {loading ? <span className="spinner" style={{ width: 14, height: 14 }} /> : icon}
      {children}
    </button>
  );
}

export function LinkButton({
  to,
  children,
  icon,
  variant = 'default',
  size = 'md',
}: {
  to: string;
  children: ReactNode;
  icon?: ReactNode;
  variant?: 'default' | 'primary';
  size?: 'md' | 'sm';
}) {
  return (
    <Link
      to={to}
      className={['btn', variant === 'primary' && 'btn-primary', size === 'sm' && 'btn-sm'].filter(Boolean).join(' ')}
    >
      {icon}
      {children}
    </Link>
  );
}

/* ---------------------------------- Fields --------------------------------- */

interface FieldProps {
  label?: ReactNode;
  required?: boolean;
  error?: string;
  hint?: ReactNode;
  className?: string;
  children: (id: string) => ReactNode;
}

export function Field({ label, required, error, hint, className = '', children }: FieldProps) {
  const id = useId();
  return (
    <div className={`field ${className}`}>
      {label && (
        <label className="field-label" htmlFor={id}>
          {label}
          {required && <span className="req">*</span>}
        </label>
      )}
      {children(id)}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}

type WithField = { label?: ReactNode; error?: string; hint?: ReactNode; fieldClassName?: string };

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & WithField>(
  function TextInput({ label, error, hint, fieldClassName, required, ...rest }, ref) {
    return (
      <Field label={label} required={required} error={error} hint={hint} className={fieldClassName}>
        {(id) => (
          <input
            ref={ref}
            id={id}
            className="input"
            aria-invalid={error ? true : undefined}
            required={required}
            {...rest}
          />
        )}
      </Field>
    );
  },
);

export function TextArea({
  label,
  error,
  hint,
  fieldClassName,
  required,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & WithField) {
  return (
    <Field label={label} required={required} error={error} hint={hint} className={fieldClassName}>
      {(id) => (
        <textarea id={id} className="textarea" aria-invalid={error ? true : undefined} required={required} {...rest} />
      )}
    </Field>
  );
}

export interface Option {
  value: string;
  label: string;
}

export function enumOptions(values: readonly string[]): Option[] {
  return values.map((v) => ({ value: v, label: formatEnum(v) }));
}

export function SelectInput({
  label,
  error,
  hint,
  fieldClassName,
  options,
  placeholder,
  required,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & WithField & { options: Option[]; placeholder?: string }) {
  return (
    <Field label={label} required={required} error={error} hint={hint} className={fieldClassName}>
      {(id) => (
        <select id={id} className="select" aria-invalid={error ? true : undefined} required={required} {...rest}>
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

export function Checkbox({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="checkbox">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/* --------------------------------- Layout ---------------------------------- */

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Panel({
  title,
  actions,
  children,
  flush,
  footer,
  className = '',
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <header className="panel-header">
          {typeof title === 'string' ? <h2>{title}</h2> : title}
          {actions && <div className="row">{actions}</div>}
        </header>
      )}
      <div className={`panel-body ${flush ? 'flush' : ''}`}>{children}</div>
      {footer && <footer className="panel-footer">{footer}</footer>}
    </section>
  );
}

export function Notice({
  children,
  tone = 'info',
}: {
  children: ReactNode;
  tone?: 'info' | 'warn' | 'danger';
}) {
  return (
    <div className={`notice ${tone === 'info' ? '' : tone}`} role={tone === 'info' ? 'note' : 'alert'}>
      {tone === 'info' ? <Info size={16} /> : <AlertTriangle size={16} />}
      <div>{children}</div>
    </div>
  );
}

export function KeyValue({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="kv">
      {items.map(([k, v], i) => (
        <div key={i} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v === undefined || v === null || v === '' ? <span className="subtle">Not recorded</span> : v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: T; label: ReactNode }[];
  active: T;
  onChange: (key: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={active === t.key}
          className={`tab ${active === t.key ? 'active' : ''}`}
          onClick={() => onChange(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented" role="group">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={value === o.value ? 'active' : ''}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
