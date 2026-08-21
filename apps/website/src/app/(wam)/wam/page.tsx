import { InteractiveMatrix } from "@/components/wam/InteractiveMatrix";
import { resolveMatrixBrowseState } from "@/lib/wam/matrix-browser";
import { MATRIX_CELLS, MATRIX_COLUMNS, MATRIX_ROWS } from "@/lib/wam/matrix";

type Props = {
  searchParams: Promise<{
    view?: string;
    axis?: string;
    item?: string;
  }>;
};

export default async function MapPage({ searchParams }: Props) {
  const query = await searchParams;
  const initialBrowseState = resolveMatrixBrowseState(
    { view: query.view, axis: query.axis, itemId: query.item },
    MATRIX_ROWS,
    MATRIX_COLUMNS,
  );

  return (
    <InteractiveMatrix
      rows={MATRIX_ROWS}
      columns={MATRIX_COLUMNS}
      cells={MATRIX_CELLS}
      initialBrowseState={initialBrowseState}
    />
  );
}
