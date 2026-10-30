import Link from "next/link";
import { requireOwner } from "@/lib/context";
import { bishkekDate } from "@/lib/day-summary";
import { features } from "@/lib/features";
import { FeatureCards } from "@/components/feature-cards";

/** «Что умеет Depter»: карточки возможностей, по нажатию — как это работает (src/lib/features.ts). */
export default async function FeaturesPage() {
  const { organizationId, organizationName, business, modules, currency } = await requireOwner();
  const list = features({ business, modules, currency, shopName: organizationName, today: bishkekDate() });
  return (
    <>
      <Link className="back-link" href="/">
        ← Главная
      </Link>
      <div className="page-heading">
        <div>
          <h1>Что умеет Depter</h1>
          <p className="muted">Нажмите на карточку - покажем, как это работает.</p>
        </div>
      </div>
      <FeatureCards features={list} shopId={organizationId} />
    </>
  );
}
