export function NewCalculationDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <div onClick={onClose}>NewCalculationDialog stub — built in Task 8</div>;
}
