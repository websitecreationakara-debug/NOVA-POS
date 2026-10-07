import { redirect } from "next/navigation";
import { getBrands, getStockPickerItems } from "@/lib/supabase/queries";
import { getSessionUser } from "@/lib/supabase/auth-server";
import {
  getCrmChartDataAction,
  getProductInsightAction,
  getProductMonthlyAction,
  listCustomerFilterOptionsAction,
  listCustomersAction,
  listPromotionsAction,
} from "./actions";
import { parseCustomerFilters } from "@/lib/customerFilters";
import { ppToday } from "@/lib/phnomPenhTime";
import { getSetAction, listSetsAction } from "./costControlActions";
import MarketingClient from "./MarketingClient";
import CrmChartsClient from "./CrmChartsClient";
import ProductInsightClient from "./ProductInsightClient";
import ProductMonthlyClient from "./ProductMonthlyClient";
import { parseInsightRange } from "@/lib/productInsight";
import CostControlClient from "./CostControlClient";

export default async function MarketingPage({
  searchParams,
}: {
  searchParams: Promise<{
    brand?: string;
    q?: string;
    tab?: string;
    set?: string;
    page?: string;
    limit?: string;
    sort?: string;
    state?: string;
    gender?: string;
    age?: string;
    since_from?: string;
    since_to?: string;
    bought_from?: string;
    bought_to?: string;
    customer?: string;
    range?: string;
    from?: string;
    to?: string;
    view?: string;
    year?: string;
    g?: string;
    a?: string;
    b?: string;
    province?: string;
  }>;
}) {
  const sp = await searchParams;
  const { brand: brandId = "", q = "", tab, set: setParam, page: pageParam, limit: limitParam } = sp;
  const customerFilters = parseCustomerFilters(sp);

  // Sale Customer Support (role "sales") gets the CRM customer list only: no
  // promotions, no Cost Control, no deleting or importing customers.
  const caller = await getSessionUser();
  const crmOnly = caller?.role === "sales";
  if (crmOnly && (tab === "cost-control" || tab === "product-insight")) redirect("/marketing");

  // CRM Charts: customers by province / gender / age / nationality / district,
  // new customers per month and top buyers.
  if (tab === "crm-charts") {
    return (
      <CrmChartsClient
        data={await getCrmChartDataAction({ gran: sp.g ?? "", anchor: sp.a, compare: sp.b, province: sp.province })}
      />
    );
  }

  // Product Insight: what sells, by period and business (not for the CRM-only role).
  if (tab === "product-insight") {
    // "Insight by Quantity" / "Insight by Price": each product per month of a year.
    if (sp.view === "quantity" || sp.view === "price") {
      const [brandList, monthly] = await Promise.all([
        getBrands(),
        getProductMonthlyAction(parseInt(sp.year ?? "", 10), brandId),
      ]);
      return (
        <ProductMonthlyClient
          rows={monthly.rows}
          year={monthly.year}
          years={monthly.years}
          brandId={brandId}
          brands={brandList}
          initialView={sp.view}
        />
      );
    }
    const range = parseInsightRange(sp.range);
    const [brandList, result] = await Promise.all([getBrands(), getProductInsightAction(range, brandId, { from: sp.from, to: sp.to })]);
    return (
      <ProductInsightClient
        insight={result.insight}
        range={range}
        brandId={brandId}
        brands={brandList}
        from={result.from}
        to={result.to}
      />
    );
  }
  const limit = Math.min(Math.max(parseInt(limitParam ?? "", 10) || 50, 1), 200);
  const page = Math.max(parseInt(pageParam ?? "", 10) || 1, 1);

  if (tab === "cost-control") {
    const brands = await getBrands();
    if (brands.length === 0) {
      return (
        <main className="p-8">
          <h1 className="text-2xl font-semibold">Cost Control</h1>
          <p className="mt-2 text-zinc-500">No brands configured yet.</p>
        </main>
      );
    }
    const currentBrand = brands.find((b) => b.id === brandId) ?? brands[0];
    const activeSetId = setParam && setParam !== "new" ? setParam : null;

    const [sets, pickerItems, activeSet] = await Promise.all([
      listSetsAction(currentBrand.id),
      getStockPickerItems(currentBrand.id, currentBrand.slug, { includeAddons: true }),
      activeSetId ? getSetAction(activeSetId) : Promise.resolve(null),
    ]);

    return (
      <CostControlClient
        brands={brands}
        currentBrand={currentBrand}
        sets={sets}
        items={pickerItems}
        activeSet={activeSet}
        isBuilderOpen={!!setParam}
      />
    );
  }

  // brandId/q come straight from the URL, so promotions/customers don't
  // actually depend on the brands list -- fetch all three in parallel
  // instead of waiting on getBrands() first.
  const [brands, promotions, { customers, total, buying, businesses }, filterOptions] = await Promise.all([
    getBrands(),
    crmOnly ? Promise.resolve([]) : listPromotionsAction(brandId),
    listCustomersAction(q, page, limit, customerFilters),
    listCustomerFilterOptionsAction(),
  ]);

  return (
    <MarketingClient
      brands={brands}
      currentBrandId={brandId}
      promotions={promotions}
      customers={customers}
      customerTotal={total}
      customerPage={page}
      customerLimit={limit}
      customerBuying={buying}
      customerBusinesses={businesses}
      customerFilters={customerFilters}
      filterOptions={filterOptions}
      today={ppToday()}
      crmOnly={crmOnly}
      openCustomerId={sp.customer ?? ""}
      searchTerm={q}
    />
  );
}
