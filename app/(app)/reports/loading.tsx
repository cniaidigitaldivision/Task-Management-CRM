import {
  SkeletonHeader,
  SkeletonKpiRow,
  SkeletonPage,
  SkeletonTable,
  SkeletonToolbar,
} from '@/components/ui/skeleton';

/* Reports: the type / period / who controls, four figures, then the table. The
   page computes its first report on the server, so this is the one screen where the
   skeleton is doing real work rather than covering a few milliseconds. */
export default function Loading() {
  return (
    <SkeletonPage label="Building the report">
      <SkeletonHeader />
      <SkeletonToolbar groups={3} />
      <SkeletonKpiRow />
      <SkeletonTable rows={8} columns={6} />
    </SkeletonPage>
  );
}
