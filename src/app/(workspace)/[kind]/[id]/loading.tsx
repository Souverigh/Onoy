import { SkeletonHeading, SkeletonList, SkeletonPage, SkeletonTiles } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <SkeletonHeading />
      <SkeletonTiles count={2} className="debt-cards" />
      <SkeletonList rows={8} />
    </SkeletonPage>
  );
}
