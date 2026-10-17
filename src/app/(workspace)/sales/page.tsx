import { RecordsPage } from "@/components/records-page";

export default function Page({ searchParams }: { searchParams: Promise<{ page?: string; deleted?: string; error?: string }> }) {
  return <RecordsPage kind="sale" searchParams={searchParams} />;
}
