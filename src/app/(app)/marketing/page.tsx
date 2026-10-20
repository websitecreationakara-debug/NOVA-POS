import { redirect } from "next/navigation";
import { getBrands, getStockPickerItems, type StockPickerItem } from "@/lib/supabase/queries";
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
import { getSetAction, listSetsAction, type SetSummary } from "./costControlActions";
import MarketingClient from "./MarketingClient";
import CrmChartsClient from "./CrmChartsClient";
import ProductInsightClient from "./ProductInsightClient";
import ProductMonthlyClient from "./ProductMonthlyClient";
import { parseInsightRange } from "@/lib/productInsight";
import CostControlClient from "./CostControlClient";
import { catalogForBrandSlug } from "@/lib/websiteProducts/catalogs";
import {
  addonToWebsiteProduct,
  listWebsiteAddons,
  listWebsiteProducts,
  markWebsiteSynced,
  websiteSyncDue,
} from "@/lib/websiteProducts/client";
import { syncWebsiteToPos } from "@/lib/websiteProducts/syncFromWebsite";

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

    // The sets list is paged in the database: ?page=N&limit=M (and ?q= for its
    // search box). Land on explicit values so the address always shows them.
    const setsLimit = Math.min(Math.max(parseInt(limitParam ?? "", 10) || 25, 1), 100);
    const setsPage = Math.max(parseInt(pageParam ?? "", 10) || 1, 1);
    if (!setParam && (!pageParam || !limitParam)) {
      redirect(
        `/marketing?${new URLSearchParams({
          tab: "cost-control",
          ...(brandId ? { brand: brandId } : {}),
          ...(q ? { q } : {}),
          page: String(setsPage),
          limit: String(setsLimit),
        })}`
      );
    }

    // Opening a set: copy the website's current names, pictures and weights onto the POS products
    // first, so its lines match Stock even if a product was changed on the storefront directly.
    // Best-effort and capped at 3s -- a slow or down storefront never holds the page up.
    // Only repeated every few minutes (the same gate as the Stock page): the copy re-reads
    // every POS product, and nothing has usually changed since the last one.
    if (setParam) {
      const catalog = catalogForBrandSlug(currentBrand.slug);
      if (catalog && websiteSyncDue(catalog.id)) {
        await Promise.race([
          Promise.all([listWebsiteProducts(catalog.id), listWebsiteAddons(catalog.id).catch(() => [])])
            .then(([p, addons]) => syncWebsiteToPos(currentBrand.slug, [...p, ...addons.map(addonToWebsiteProduct)]))
            .then(() => markWebsiteSynced(catalog.id)),
          new Promise((resolve) => setTimeout(resolve, 3000)),
        ]).catch((e) => console.error("cost control: couldn't sync website products to the POS", e));
      }
    }

    // Each view only loads what it shows: the list needs the page of sets; the set
    // builder needs the product picker (which reads the storefront catalogs) and the
    // open set -- so opening the list no longer waits on the storefronts.
    const [setsPageResult, pickerItems, activeSet] = await Promise.all([
      setParam
        ? Promise.resolve({ sets: [] as SetSummary[], total: 0, page: 1 })
        : listSetsAction(currentBrand.id, { page: setsPage, limit: setsLimit, q }),
      setParam
        ? getStockPickerItems(currentBrand.id, currentBrand.slug, { includeAddons: true })
        : Promise.resolve([] as StockPickerItem[]),
      activeSetId ? getSetAction(activeSetId) : Promise.resolve(null),
    ]);

    return (
      <CostControlClient
        brands={brands}
        currentBrand={currentBrand}
        sets={setsPageResult.sets}
        setsTotal={setsPageResult.total}
        setsPage={setsPageResult.page}
        setsLimit={setsLimit}
        setsQuery={q}
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
