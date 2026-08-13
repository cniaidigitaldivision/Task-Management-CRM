import {
  SkeletonHeader,
  SkeletonKpiRow,
  SkeletonPage,
  SkeletonTable,
} from '@/components/ui/skeleton';

/* Security: the counts, then four paginated lists — sessions, login attempts, the
   audit log and the events. Two are placeheld; the rest are below the fold. */
export default function Loading() {
  return (
    <SkeletonPage label="Loading security">
      <SkeletonHeader />
      <SkeletonKpiRow />
      <SkeletonTable rows={6} columns={5} />
      <SkeletonTable rows={6} columns={4} />
    </SkeletonPage>
  );
}
