import {
  Skeleton,
  SkeletonHeader,
  SkeletonPage,
  SkeletonTable,
  SkeletonToolbar,
} from '@/components/ui/skeleton';

/* The vault: the notice that this holds no CNI sign-in passwords, the filters,
   then the table of stored credentials. */
export default function Loading() {
  return (
    <SkeletonPage label="Loading the vault">
      <SkeletonHeader />
      <div className="flex items-start gap-3 rounded-xl border border-border-default bg-bg-surface p-4 shadow-sm">
        <Skeleton rounded="lg" className="h-10 w-10 shrink-0" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-72 max-w-full" />
          <Skeleton rounded="sm" className="h-2.5 w-full" />
        </div>
      </div>
      <SkeletonToolbar groups={2} />
      <SkeletonTable rows={5} columns={5} />
    </SkeletonPage>
  );
}
