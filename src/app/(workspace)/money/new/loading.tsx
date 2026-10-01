import { SkeletonForm, SkeletonHeading, SkeletonPage } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <SkeletonHeading subtitle={false} />
      <SkeletonForm fields={3} />
    </SkeletonPage>
  );
}
