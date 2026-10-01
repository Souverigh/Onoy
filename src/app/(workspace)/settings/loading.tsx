import { SkeletonHeading, SkeletonList, SkeletonPage } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <SkeletonHeading subtitle={false} />
      <SkeletonList rows={4} />
      <SkeletonList rows={3} />
    </SkeletonPage>
  );
}
