/** Token size picker: common sizes in cells, with D&D size names, and optionally "map default". */

/** Preset sizes in cells. Any other value (sent through the API) is shown too. */
export const SIZE_PRESETS: Array<{ value: number; label: string }> = [
  { value: 0.25, label: "¼ cell" },
  { value: 0.5, label: "½ cell (Tiny)" },
  { value: 0.75, label: "¾ cell" },
  { value: 1, label: "1 cell (Small / Medium)" },
  { value: 1.5, label: "1½ cells" },
  { value: 2, label: "2 cells (Large)" },
  { value: 3, label: "3 cells (Huge)" },
  { value: 4, label: "4 cells (Gargantuan)" },
  { value: 5, label: "5 cells" },
  { value: 6, label: "6 cells" },
];

const DEFAULT = "default";

export function sizeLabel(value: number): string {
  return SIZE_PRESETS.find((p) => p.value === value)?.label ?? `${value} cells`;
}

interface Props {
  label: string;
  name: string;
  value: number | null;
  /** When set, a "map default" option is offered and null means "use it". */
  defaultSize?: number;
  onCommit(value: number | null): void;
}

export function SizeSelect({ label, name, value, defaultSize, onCommit }: Props) {
  const allowDefault = defaultSize !== undefined;
  const options = [...SIZE_PRESETS];
  if (value !== null && !options.some((o) => o.value === value)) options.push({ value, label: sizeLabel(value) });
  options.sort((a, b) => a.value - b.value);
  return (
    <label class="field">
      <span>{label}</span>
      <select
        name={name}
        value={value === null ? DEFAULT : String(value)}
        onChange={(e) => {
          const v = (e.currentTarget as HTMLSelectElement).value;
          onCommit(v === DEFAULT ? null : Number(v));
        }}
      >
        {allowDefault && <option value={DEFAULT}>{`Map default (${sizeLabel(defaultSize)})`}</option>}
        {options.map((o) => (
          <option key={o.value} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
