import { SkeletonHeading, SkeletonList, SkeletonPage } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <SkeletonHeading />
      <SkeletonList rows={8} />
    </SkeletonPage>
  );
}
