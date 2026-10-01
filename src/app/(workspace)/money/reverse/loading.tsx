import { SkeletonHeading, SkeletonList, SkeletonPage } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <SkeletonHeading />
      <SkeletonList rows={2} title={false} />
    </SkeletonPage>
  );
}
