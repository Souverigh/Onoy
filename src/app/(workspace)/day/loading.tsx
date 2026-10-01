import { SkeletonHeading, SkeletonList, SkeletonPage, SkeletonTiles } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <SkeletonHeading />
      <SkeletonTiles count={4} className="skeleton-grid" />
      <SkeletonList rows={6} />
    </SkeletonPage>
  );
}
