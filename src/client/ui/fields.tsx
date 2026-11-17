/**
 * Form fields that commit on `change` (Enter or leaving the field) and that
 * are never overwritten by an incoming server update while the user is
 * typing in them.
 */
import { Component, createRef } from "preact";

interface FieldProps<T> {
  label: string;
  value: T;
  onCommit(value: T): void;
  name?: string;
  class?: string;
}

/** Shared logic: the DOM element is updated from props only when not focused. */
abstract class LiveField<T, E extends HTMLInputElement | HTMLTextAreaElement, P extends FieldProps<T>> extends Component<P> {
  protected ref = createRef<E>();

  protected abstract format(value: T): string;
  /** Returns undefined when the text is not a valid value. */
  protected abstract parse(text: string): T | undefined;

  override componentDidMount(): void {
    this.sync();
  }

  override componentDidUpdate(): void {
    this.sync();
  }

  private sync(): void {
    const el = this.ref.current;
    if (el && el.ownerDocument.activeElement !== el) el.value = this.format(this.props.value);
  }

  protected commit = (): void => {
    const el = this.ref.current;
    if (!el) return;
    const value = this.parse(el.value);
    if (value === undefined || value === this.props.value) {
      el.value = this.format(this.props.value);
      return;
    }
    this.props.onCommit(value);
  };
}

export class TextField extends LiveField<string, HTMLInputElement, FieldProps<string>> {
  protected format(v: string): string {
    return v;
  }
  protected parse(text: string): string | undefined {
    const t = text.trim();
    return t.length > 0 ? t : undefined;
  }
  render() {
    return (
      <label class={`field ${this.props.class ?? ""}`}>
        <span>{this.props.label}</span>
        <input ref={this.ref} type="text" name={this.props.name} maxLength={80} onChange={this.commit} />
      </label>
    );
  }
}

interface NumberProps extends FieldProps<number> {
  min?: number;
  max?: number;
}

export class NumberField extends LiveField<number, HTMLInputElement, NumberProps> {
  protected format(v: number): string {
    return String(v);
  }
  protected parse(text: string): number | undefined {
    const n = Number(text);
    if (text.trim() === "" || !Number.isInteger(n)) return undefined;
    const { min = -Infinity, max = Infinity } = this.props;
    return Math.min(max, Math.max(min, n));
  }
  render() {
    return (
      <label class={`field ${this.props.class ?? ""}`}>
        <span>{this.props.label}</span>
        <input
          ref={this.ref}
          type="number"
          name={this.props.name}
          min={this.props.min}
          max={this.props.max}
          step={1}
          onChange={this.commit}
        />
      </label>
    );
  }
}

export class NotesField extends LiveField<string, HTMLTextAreaElement, FieldProps<string>> {
  protected format(v: string): string {
    return v;
  }
  protected parse(text: string): string {
    return text;
  }
  render() {
    return (
      <label class={`field field-notes ${this.props.class ?? ""}`}>
        <span>{this.props.label}</span>
        <textarea ref={this.ref} name={this.props.name} rows={5} maxLength={20000} onChange={this.commit} />
      </label>
    );
  }
}

/** Colour picker; commits immediately. */
export function ColorField(props: FieldProps<string>) {
  return (
    <label class="field field-color">
      <span>{props.label}</span>
      <input
        type="color"
        name={props.name}
        value={props.value}
        onChange={(e) => props.onCommit((e.currentTarget as HTMLInputElement).value)}
      />
    </label>
  );
}

/** File picker for images; resets itself after each pick. */
export function ImagePicker(props: { label: string; name?: string; onPick(file: File): void }) {
  return (
    <label class="field field-file">
      <span>{props.label}</span>
      <input
        type="file"
        name={props.name}
        accept="image/png,image/jpeg,image/webp"
        onChange={(e) => {
          const input = e.currentTarget as HTMLInputElement;
          const file = input.files?.[0];
          if (file) props.onPick(file);
          input.value = "";
        }}
      />
    </label>
  );
}
