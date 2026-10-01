import { SkeletonDocument, SkeletonHeading, SkeletonPage } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <SkeletonHeading />
      <SkeletonDocument />
    </SkeletonPage>
  );
}
