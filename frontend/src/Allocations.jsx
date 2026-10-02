import { money } from "./domain";

export default function Allocations({ values = {}, people = [], names }) {
  const labels = names || Object.fromEntries(people.map((p) => [p.id, p.name]));
  return (
    <div className="allocation-summary">
      {Object.entries(values).map(([id, value]) => (
        <div key={id} title={id}>
          {labels[id] || id}: <strong>{money(value)}</strong>
        </div>
      ))}
    </div>
  );
}
