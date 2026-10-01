import { SkeletonForm, SkeletonHeading, SkeletonList, SkeletonPage } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <SkeletonHeading />
      <SkeletonForm fields={2} />
      <SkeletonList rows={5} />
    </SkeletonPage>
  );
}
