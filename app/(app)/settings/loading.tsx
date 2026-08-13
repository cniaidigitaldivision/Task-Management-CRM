import {
  SkeletonHeader,
  SkeletonPage,
  SkeletonSection,
  SkeletonTabs,
} from '@/components/ui/skeleton';

/* Settings is tabs down the left beside one panel (CHANGE-PLAN 6.4). Only the
   first section is skeletoned: the skills library and the fixed-by-design tables
   sit below the fold, and placeholders nobody sees are placeholders for nothing. */
export default function Loading() {
  return (
    <SkeletonPage label="Loading settings">
      <SkeletonHeader />
      <SkeletonSection>
        <SkeletonTabs tabs={4} rows={7} />
      </SkeletonSection>
    </SkeletonPage>
  );
}
