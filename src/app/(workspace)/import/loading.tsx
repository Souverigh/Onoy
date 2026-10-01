import { SkeletonForm, SkeletonHeading, SkeletonPage } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <SkeletonHeading />
      <SkeletonForm fields={1} />
    </SkeletonPage>
  );
}
