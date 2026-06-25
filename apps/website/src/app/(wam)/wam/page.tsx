import { InteractiveMatrix } from "@/components/wam/InteractiveMatrix";
import { MATRIX_CELLS, MATRIX_COLUMNS, MATRIX_ROWS } from "@/lib/wam/matrix";

export default function MapPage() {
  return <InteractiveMatrix rows={MATRIX_ROWS} columns={MATRIX_COLUMNS} cells={MATRIX_CELLS} />;
}
