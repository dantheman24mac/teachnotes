import { STATUS_LABELS } from "@/lib/domain";
import type { LessonStatus } from "@/lib/types";

export function StatusChip({ status }: { status: LessonStatus }) {
  return <span className={`status status-${status}`}><span aria-hidden="true" />{STATUS_LABELS[status]}</span>;
}
