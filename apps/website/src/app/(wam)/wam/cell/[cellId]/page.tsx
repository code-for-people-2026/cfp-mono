import { redirect } from "next/navigation";
import { CellDetailView } from "@/components/wam/CellDetailView";
import { getMatrixCell, MATRIX_CELLS, MATRIX_COLUMNS, MATRIX_ROWS } from "@/lib/wam/matrix";

type Props = {
  params: Promise<{
    cellId: string;
  }>;
};

export default async function CellPage({ params }: Props) {
  const { cellId } = await params;
  const cell = getMatrixCell(cellId);

  if (!cell) {
    redirect("/wam");
  }

  return (
    <CellDetailView
      key={cell.id}
      rows={MATRIX_ROWS}
      columns={MATRIX_COLUMNS}
      cells={MATRIX_CELLS}
      initialCellId={cell.id}
    />
  );
}
